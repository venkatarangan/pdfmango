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
  ImageExportOptions,
  OpenResult,
  PageImage,
  PageEdit,
  PageSize,
  Rotation,
} from '../lib/types';
import { exifOrientation, isJpeg, stripJpegMetadata, type Orientation } from './jpeg';
import { imagePageContent, imagePageLayout, swapsAxes, type ImageGeometry } from './layout';
import { docxToHtml, htmlToPdf, textToHtml } from './convert';
import { downsampleImages, makeYielder, pageSizes, readNotices, renderPage, scanDocument } from './pdf-tools';
import { derivedImage, drawView, dropDerived, editGraftedPage, needsPixels, pinDerived, turnedImageContent, viewSize, viewWidth, type View } from './page-edits';
import { analyseSpread as analyseSpreadPixels, type SpreadAnalysis } from './spread';
import { detectSkew as findSkew, toGray, type SkewResult } from './projection';
import { config } from '../pdfmango.config';

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

/**
 * A Word or text file, converted once into PDF pages (A4, 1-inch margins) and then kept as an
 * ordinary PDF source. Fonts for Indian scripts and Arabic are fetched as the text needs them.
 */
export async function convert(kind: 'docx' | 'text', bytes: ArrayBuffer): Promise<OpenResult> {
  let html: string;
  try {
    html = kind === 'docx' ? await docxToHtml(bytes) : textToHtml(new Uint8Array(bytes));
  } catch (e) {
    throw toCode(e) === 'out-of-memory' ? e : new EngineError(kind === 'docx' ? 'word-unreadable' : 'unreadable');
  }
  const doc = await htmlToPdf(html, makeYielder(() => false));
  const sourceId = `s${nextId++}`;
  sources.set(sourceId, { kind: 'pdf', doc, wasEncrypted: false });
  return finishOpen(sourceId, false);
}

/** A blank page of the given size (points), held as a one-page PDF so it exports like any other page. */
export function addBlank(widthPt: number, heightPt: number): string {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(-1, doc.addPage([0, 0, widthPt, heightPt], 0, {}, ''));
  const sourceId = `s${nextId++}`;
  sources.set(sourceId, { kind: 'pdf', doc, wasEncrypted: false });
  return sourceId;
}

// ---- Thumbnails --------------------------------------------------------------------------------------

export function renderThumb(sourceId: string, srcIndex: number, widthPx: number, edit?: PageEdit): ImageData {
  if (edit) return renderEditedThumb(sourceId, srcIndex, widthPx, edit);
  const src = sources.get(sourceId);
  if (!src) throw new EngineError('unreadable');
  const page = src.doc.loadPage(srcIndex);
  try {
    return renderPage(page, widthPx);
  } finally {
    page.destroy();
  }
}

// ---- Pages as images -----------------------------------------------------------------------------

/** Long side of A4 in points: photos are never made larger than an A4 page at the chosen resolution. */
const A4_LONG_PT = 842;
/** Above this many PNG bytes per pixel a page is photo-like (text pages measure under 0.2), and Auto saves it as JPG. */
const PHOTO_BYTES_PER_PIXEL = 0.4;

/**
 * Renders one page, upright and with its added rotation, on white. PDF pages render at `dpi`;
 * photo pages keep their own pixels, capped at an A4 page's size at `dpi`. Every image is capped
 * at `maxPixels`. The output carries no metadata.
 */
export function renderImage(p: ExportPage, opts: ImageExportOptions): PageImage {
  const src = sources.get(p.sourceId);
  if (!src) throw new EngineError('export-failed');
  if (p.edit) return encodePageImage(renderEditedImage(p, p.edit, src.kind === 'image', opts), opts);
  const page = src.doc.loadPage(p.srcIndex);
  let pix: mupdf.Pixmap | undefined;
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const [w, h] = [Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
    // Image sources are drawn at 1 px = 1 pt, so scale 1 is the photo's own resolution.
    let scale = src.kind === 'image' ? Math.min(1, (A4_LONG_PT * opts.dpi) / 72 / Math.max(w, h)) : opts.dpi / 72;
    scale = Math.min(scale, Math.sqrt(opts.maxPixels / (w * h)));
    const ctm = mupdf.Matrix.concat(mupdf.Matrix.scale(scale, scale), mupdf.Matrix.rotate(p.addedRotation));
    pix = page.toPixmap(ctm, mupdf.ColorSpace.DeviceRGB, false, true);
    const jpg = () => ({ bytes: pix!.asJPEG(opts.jpegQuality, false).slice().buffer as ArrayBuffer, ext: 'jpg' as const });
    if (opts.format === 'jpg') return jpg();
    const png = pix.asPNG().slice();
    if (opts.format === 'auto' && png.length > pix.getWidth() * pix.getHeight() * PHOTO_BYTES_PER_PIXEL) return jpg();
    return { bytes: png.buffer as ArrayBuffer, ext: 'png' };
  } finally {
    pix?.destroy();
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
  pinDerived(true);
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
        if (p.edit) editGraftedPage(out, out.countPages() - 1, pageObj, p.edit);
        // /Rotate may be inherited from the page tree; graftPage copies it onto the page.
        const base = pageObj.getInheritable('Rotate');
        const original = base.isNumber() ? base.asNumber() : 0;
        pageObj.put('Rotate', ((((original + p.addedRotation) % 360) + 360) % 360));
        // Page-level XMP and editor data can name the author or the software; the output keeps neither.
        pageObj.delete('Metadata');
        pageObj.delete('PieceInfo');
      } else if (p.edit) {
        addEditedImagePage(out, maps, p, p.edit, src, opts);
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
    setInfo(out, opts);
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
      setInfo(scanned, opts);
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
    pinDerived(false);
    cancelRequested = false;
  }
}

/**
 * The output starts with empty document properties (pages are copied into a new file, so the
 * originals' author, title and XMP never come along). Only the credit line and title are set.
 */
function setInfo(doc: mupdf.PDFDocument, opts: ExportOptions) {
  if (opts.creditLine) doc.setMetaData('info:Producer', opts.creditLine);
  if (opts.title) doc.setMetaData('info:Title', opts.title);
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
  dropDerived(sourceId);
  const src = sources.get(sourceId);
  if (!src) return;
  src.doc.destroy();
  sources.delete(sourceId);
}

export function reset() {
  dropDerived();
  for (const id of [...sources.keys()]) dispose(id);
  mupdf.emptyStore();
}

// ---- Edited pages (Straighten, fine rotation, Straighten photo, Split) ------------------------------
// Only pages that carry edits come here; untouched pages keep the code paths above.

/** The page to draw for `edit`, and the parts of the edit still to apply while drawing. */
function viewOf(sourceId: string, srcIndex: number, edit: PageEdit): View {
  const src = sources.get(sourceId);
  if (!src) throw new EngineError('unreadable');
  if (src.kind === 'image' && needsPixels(edit)) {
    const d = derivedImage(sourceId, src, edit);
    return { doc: d.doc, index: 0, fine: d.bakedRotation ? 0 : (edit.fineRotation ?? 0) };
  }
  return { doc: src.doc, index: srcIndex, fine: edit.fineRotation ?? 0, crop: src.kind === 'pdf' ? edit.crop : undefined };
}

function renderEditedThumb(sourceId: string, srcIndex: number, widthPx: number, edit: PageEdit): ImageData {
  const view = viewOf(sourceId, srcIndex, edit);
  const s = widthPx / viewWidth(view);
  const pix = drawView(view, [s, 0, 0, s, 0, 0], mupdf.ColorSpace.DeviceRGB, true);
  try {
    return new ImageData(new Uint8ClampedArray(pix.getPixels()), pix.getWidth(), pix.getHeight());
  } finally {
    pix.destroy();
  }
}

/** Width the page is drawn at to measure its tilt. */
const SKEW_RENDER_PX = 1000;

/**
 * How much the page's text lines are tilted, measured on the page without its current fine
 * rotation (so Straighten can run again). The caller sets fineRotation = -angle.
 */
export function detectSkew(sourceId: string, srcIndex: number, edit?: PageEdit, addedRotation: Rotation = 0): SkewResult {
  const view = viewOf(sourceId, srcIndex, { ...edit, fineRotation: undefined });
  // Measured as the page shows (with its added quarter turns). A turn by a multiple of 90° does
  // not change the tilt angle, so the answer applies to the page's fine rotation directly.
  const [w, h] = viewSize(view);
  const s = Math.min(4, SKEW_RENDER_PX / (addedRotation % 180 ? h : w));
  const after = (addedRotation ? mupdf.Matrix.concat(mupdf.Matrix.scale(s, s), mupdf.Matrix.rotate(addedRotation)) : [s, 0, 0, s, 0, 0]) as [number, number, number, number, number, number];
  const pix = drawView(view, after, mupdf.ColorSpace.DeviceGray, false);
  try {
    const g = toGray(pix.getPixels(), pix.getWidth(), pix.getHeight(), pix.getNumberOfComponents());
    return findSkew(g, { maxAngle: config.straighten.maxAngle });
  } finally {
    pix.destroy();
  }
}

function renderEditedImage(p: ExportPage, edit: PageEdit, isPhoto: boolean, opts: ImageExportOptions): mupdf.Pixmap {
  const view = viewOf(p.sourceId, p.srcIndex, edit);
  const page = view.doc.loadPage(view.index);
  let w: number;
  let h: number;
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const c = view.crop ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    [w, h] = [Math.max(1, (x1 - x0) * (c.x1 - c.x0)), Math.max(1, (y1 - y0) * (c.y1 - c.y0))];
  } finally {
    page.destroy();
  }
  let scale = isPhoto ? Math.min(1, (A4_LONG_PT * opts.dpi) / 72 / Math.max(w, h)) : opts.dpi / 72;
  scale = Math.min(scale, Math.sqrt(opts.maxPixels / (w * h)));
  const after = mupdf.Matrix.concat(mupdf.Matrix.scale(scale, scale), mupdf.Matrix.rotate(p.addedRotation));
  return drawView(view, after as [number, number, number, number, number, number], mupdf.ColorSpace.DeviceRGB, false);
}

/** Same encoding as renderImage: PNG, or JPG for photo-like pages under Auto. */
function encodePageImage(pix: mupdf.Pixmap, opts: ImageExportOptions): PageImage {
  try {
    const jpg = () => ({ bytes: pix.asJPEG(opts.jpegQuality, false).slice().buffer as ArrayBuffer, ext: 'jpg' as const });
    if (opts.format === 'jpg') return jpg();
    const png = pix.asPNG().slice();
    if (opts.format === 'auto' && png.length > pix.getWidth() * pix.getHeight() * PHOTO_BYTES_PER_PIXEL) return jpg();
    return { bytes: png.buffer as ArrayBuffer, ext: 'png' };
  } finally {
    pix.destroy();
  }
}

/** A photo page with edits: new pixels for corners and crops, a content turn for fine rotation. */
function addEditedImagePage(out: mupdf.PDFDocument, maps: Map<string, mupdf.PDFGraftMap>, p: ExportPage, edit: PageEdit, src: ImageSource, opts: ExportOptions) {
  let img: ImageSource = src;
  let fine = edit.fineRotation ?? 0;
  let mapKey = p.sourceId;
  if (needsPixels(edit)) {
    const d = derivedImage(p.sourceId, src, edit);
    img = d;
    mapKey = d.key;
    if (d.bakedRotation) fine = 0;
  }
  let map = maps.get(mapKey);
  if (!map) maps.set(mapKey, (map = out.newGraftMap()));
  const ref = map.graftObject(img.imageRef);
  const layout = imagePageLayout(img.geometry, opts.imagePageSize, opts.marginPt);
  let content = imagePageContent(img.orient, layout);
  if (fine) content = turnedImageContent(content, layout.pageW, layout.pageH, fine);
  out.insertPage(-1, out.addPage([0, 0, layout.pageW, layout.pageH], p.addedRotation, { XObject: { Im0: ref } }, content));
}

/** Width the page is drawn at to look for a book spine. */
const SPREAD_RENDER_PX = 800;

/**
 * Looks for a book spine on a page as it shows (with its fine and added rotation, without any
 * crop). Positions come back across the page as it shows.
 */
export function analyseSpread(sourceId: string, srcIndex: number, addedRotation: Rotation, edit?: PageEdit): SpreadAnalysis {
  const view = viewOf(sourceId, srcIndex, { ...edit, crop: undefined });
  const [w, h] = viewSize(view);
  const s = Math.min(4, SPREAD_RENDER_PX / (addedRotation % 180 ? h : w));
  const after = mupdf.Matrix.concat(mupdf.Matrix.scale(s, s), mupdf.Matrix.rotate(addedRotation)) as [number, number, number, number, number, number];
  const pix = drawView(view, after, mupdf.ColorSpace.DeviceGray, false);
  try {
    const g = toGray(pix.getPixels(), pix.getWidth(), pix.getHeight(), pix.getNumberOfComponents());
    return analyseSpreadPixels(g, { minAspect: config.split.minAspect, band: config.split.middleBand, minConfidence: config.split.minConfidence });
  } finally {
    pix.destroy();
  }
}
