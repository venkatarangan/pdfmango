// The PDF engine: owns every opened file and builds the output PDF. Runs only inside the worker.
import * as mupdf from 'mupdf';
import { LOSSLESS_OPTIONS } from '../lib/compression';
import type {
  AddImageResult,
  EngineErrorCode,
  ExportOptions,
  ExportPage,
  ExportProgress,
  ExportResult,
  OpenResult,
  PageSize,
} from '../lib/types';
import { exifOrientation, isJpeg, stripJpegMetadata, type Orientation } from './jpeg';
import { imagePageContent, imagePageLayout, swapsAxes, type ImageGeometry } from './layout';
import { downsampleImages, makeYielder, pageSizes, readNotices, renderPage, scanDocument } from './pdf-tools';

mupdf.setLog({ warning: () => {}, error: () => {} }); // never echo document details to the console

type PdfSource = { kind: 'pdf'; doc: mupdf.PDFDocument; wasEncrypted: boolean };
type ImageSource = { kind: 'image'; doc: mupdf.PDFDocument; imageRef: mupdf.PDFObject; orient: Orientation; geometry: ImageGeometry };
const sources = new Map<string, PdfSource | ImageSource>();
let nextId = 1;
let cancelRequested = false;

export class EngineError extends Error {
  constructor(readonly code: EngineErrorCode) {
    super(code);
  }
}

/** Maps any failure to a code the UI understands. WASM allocation failures become out-of-memory. */
export function toCode(e: unknown): EngineErrorCode {
  if (e instanceof EngineError) return e.code;
  const msg = String((e as Error)?.message ?? e);
  if (msg === 'cancelled') return 'cancelled';
  if (/out of memory|malloc|memory access|Memory\.grow|allocation failed|OOM|RangeError: (Array buffer|Invalid typed array)/i.test(msg)) return 'out-of-memory';
  return 'export-failed';
}

// ---- Opening files -------------------------------------------------------------------------------

/** `respectRestrictions`: refuse PDFs whose author forbids page assembly (visitor setting). */
export function open(bytes: ArrayBuffer, respectRestrictions = true): OpenResult {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  } catch (e) {
    throw toCode(e) === 'out-of-memory' ? e : new EngineError('unreadable');
  }
  const pdf = doc.asPDF();
  if (!pdf) {
    doc.destroy();
    throw new EngineError('not-a-pdf');
  }
  const sourceId = `s${nextId++}`;
  const wasEncrypted = pdf.needsPassword();
  sources.set(sourceId, { kind: 'pdf', doc: pdf, wasEncrypted });
  if (wasEncrypted) return { status: 'needs-password', sourceId };
  return finishOpen(sourceId, respectRestrictions);
}

export function unlock(sourceId: string, password: string, respectRestrictions = true): OpenResult {
  const src = sources.get(sourceId);
  if (!src || src.kind !== 'pdf') throw new EngineError('unreadable');
  if (src.doc.authenticatePassword(password) === 0) return { status: 'needs-password', sourceId, wrongPassword: true };
  return finishOpen(sourceId, respectRestrictions);
}

function finishOpen(sourceId: string, respectRestrictions: boolean): OpenResult {
  const src = sources.get(sourceId) as PdfSource;
  try {
    const notices = readNotices(src.doc, src.wasEncrypted);
    if (notices.restricted && respectRestrictions) {
      dispose(sourceId);
      return { status: 'restricted', sourceId };
    }
    const sizes = pageSizes(src.doc);
    // Repair can happen lazily while the page tree is read, so ask again afterwards.
    notices.wasRepaired = src.doc.wasRepaired();
    if (sizes.length === 0) throw new EngineError('unreadable');
    return { status: 'ok', sourceId, pageCount: sizes.length, pageSizes: sizes, notices };
  } catch (e) {
    dispose(sourceId);
    throw e instanceof EngineError || toCode(e) === 'out-of-memory' ? e : new EngineError('unreadable');
  }
}

/**
 * An image becomes a one-page document holding the (metadata-free) image, used for thumbnails;
 * at export its image object is grafted into the output and placed on a page of the chosen size.
 */
export function addImage(bytes: ArrayBuffer): AddImageResult {
  const raw = new Uint8Array(bytes);
  const jpeg = isJpeg(raw);
  const orient: Orientation = jpeg ? exifOrientation(raw) : 1;
  let img: mupdf.Image | undefined;
  let meta: mupdf.Image | undefined;
  const doc = new mupdf.PDFDocument();
  try {
    // Resolution comes from the original (EXIF/JFIF/pHYs); the embedded copy has no EXIF.
    meta = new mupdf.Image(raw);
    let [xRes, yRes] = [meta.getXResolution(), meta.getYResolution()];
    img = jpeg ? new mupdf.Image(stripJpegMetadata(raw)) : meta;
    const [w, h] = [img.getWidth(), img.getHeight()];
    if (!(w > 0 && h > 0)) throw new EngineError('image-unreadable');
    const swap = swapsAxes(orient);
    if (swap) [xRes, yRes] = [yRes, xRes];
    const geometry: ImageGeometry = { widthPx: swap ? h : w, heightPx: swap ? w : h, xRes, yRes };
    const imageRef = doc.addImage(img);
    // Thumbnail page: the image upright at 1 px = 1 pt, no margin.
    const layout = { pageW: geometry.widthPx, pageH: geometry.heightPx, x: 0, y: 0, w: geometry.widthPx, h: geometry.heightPx };
    doc.insertPage(-1, doc.addPage([0, 0, layout.pageW, layout.pageH], 0, { XObject: { Im0: imageRef } }, imagePageContent(orient, layout)));
    const sourceId = `s${nextId++}`;
    sources.set(sourceId, { kind: 'image', doc, imageRef, orient, geometry });
    const pageSize: PageSize = [geometry.widthPx, geometry.heightPx];
    return { sourceId, widthPx: geometry.widthPx, heightPx: geometry.heightPx, pageSize };
  } catch (e) {
    doc.destroy();
    if (toCode(e) === 'out-of-memory') throw e;
    throw new EngineError('image-unreadable');
  } finally {
    if (img && img !== meta) img.destroy();
    meta?.destroy();
  }
}

// ---- Thumbnails --------------------------------------------------------------------------------------

export function renderThumb(sourceId: string, srcIndex: number, widthPx: number): ImageData {
  const src = sources.get(sourceId);
  if (!src) throw new EngineError('unreadable');
  const page = src.doc.loadPage(srcIndex);
  try {
    return renderPage(page, widthPx);
  } finally {
    page.destroy();
  }
}

// ---- Export ------------------------------------------------------------------------------------------

export function cancel() {
  cancelRequested = true;
}

export async function exportPdf(pages: ExportPage[], opts: ExportOptions, onProgress: (p: ExportProgress) => void): Promise<ExportResult> {
  cancelRequested = false;
  const yieldNow = makeYielder(() => cancelRequested);
  let lastReport = 0;
  const progress = (done: number, total: number, step: string, force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 80) return;
    lastReport = now;
    onProgress({ done, total, step });
  };

  const out = new mupdf.PDFDocument();
  const maps = new Map<string, mupdf.PDFGraftMap>();
  let scanned: mupdf.PDFDocument | undefined;
  try {
    // 1–4. Copy pages in output order; one graft map per source so shared resources are copied once.
    for (let i = 0; i < pages.length; i++) {
      progress(i, pages.length, `Copying pages ${i + 1} of ${pages.length}`);
      await yieldNow();
      const p = pages[i];
      const src = sources.get(p.sourceId);
      if (!src) throw new EngineError('export-failed');
      let map = maps.get(p.sourceId);
      if (!map) maps.set(p.sourceId, (map = out.newGraftMap()));
      if (src.kind === 'pdf') {
        map.graftPage(-1, src.doc, p.srcIndex);
        const pageObj = out.findPage(out.countPages() - 1);
        // /Rotate may be inherited from the page tree; graftPage copies it onto the page.
        const base = pageObj.getInheritable('Rotate');
        const original = base.isNumber() ? base.asNumber() : 0;
        pageObj.put('Rotate', ((((original + p.addedRotation) % 360) + 360) % 360));
      } else {
        const ref = map.graftObject(src.imageRef);
        const layout = imagePageLayout(src.geometry, opts.imagePageSize, opts.marginPt);
        const pageObj = out.addPage([0, 0, layout.pageW, layout.pageH], p.addedRotation, { XObject: { Im0: ref } }, imagePageContent(src.orient, layout));
        out.insertPage(-1, pageObj);
      }
    }
    progress(pages.length, pages.length, 'Copying pages', true);

    // 5. Lossless always runs; it is also the safety net for the other levels.
    progress(0, 1, 'Saving', true);
    await yieldNow();
    setCredit(out, opts.creditLine);
    const lossless = saveCopy(out);
    const plan = opts.plan;
    if (plan.kind === 'lossless') return result(lossless, false);

    let candidate: Uint8Array;
    if (plan.kind === 'downsample') {
      await downsampleImages(out, plan, (d, t, s) => progress(d, t, s), yieldNow);
      if (plan.subsetFonts) {
        progress(0, 1, 'Subsetting fonts', true);
        await yieldNow();
        try {
          out.subsetFonts();
        } catch {
          // A font MuPDF cannot subset is left whole; the file is still valid.
        }
      }
      progress(0, 1, 'Saving', true);
      await yieldNow();
      candidate = saveCopy(out);
    } else {
      scanned = await scanDocument(out, plan, (d, t, s) => progress(d, t, s), yieldNow);
      setCredit(scanned, opts.creditLine);
      progress(0, 1, 'Saving', true);
      await yieldNow();
      candidate = saveCopy(scanned);
    }
    // Safety net: never deliver something bigger than the Lossless file.
    return candidate.length > lossless.length ? result(lossless, true) : result(candidate, false);
  } finally {
    scanned?.destroy();
    for (const m of maps.values()) m.destroy();
    out.destroy();
    cancelRequested = false;
  }
}

/** The visitor's credit line goes into the document properties (Producer); empty leaves it unset. */
function setCredit(doc: mupdf.PDFDocument, credit: string) {
  if (credit) doc.setMetaData('info:Producer', credit);
}

function saveCopy(doc: mupdf.PDFDocument): Uint8Array {
  const buf = doc.saveToBuffer(LOSSLESS_OPTIONS);
  try {
    return buf.asUint8Array().slice();
  } finally {
    buf.destroy();
  }
}

function result(bytes: Uint8Array, fellBackToLossless: boolean): ExportResult {
  return { bytes: bytes.buffer as ArrayBuffer, outputSize: bytes.length, fellBackToLossless };
}

// ---- Housekeeping ------------------------------------------------------------------------------------

export function dispose(sourceId: string) {
  const src = sources.get(sourceId);
  if (!src) return;
  src.doc.destroy();
  sources.delete(sourceId);
}

export function reset() {
  for (const id of [...sources.keys()]) dispose(id);
  mupdf.emptyStore();
}
