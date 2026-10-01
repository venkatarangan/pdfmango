// MuPDF helpers used by the engine worker. Every MuPDF object created here is destroyed here.
import * as mupdf from 'mupdf';
import type { PageSize, PdfNotices } from '../lib/types';

/** Lets queued messages (such as cancel) run during long work; yields at most every ~30 ms. */
export function makeYielder(isCancelled: () => boolean) {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < 30) return;
    await new Promise((r) => setTimeout(r, 0));
    last = performance.now();
    if (isCancelled()) throw new Error('cancelled');
  };
}

const num = (o: mupdf.PDFObject, fallback = 0) => (o.isNumber() ? o.asNumber() : fallback);

/** Display size of every page (CropBox or MediaBox, with the page's own /Rotate), without loading pages. */
export function pageSizes(doc: mupdf.PDFDocument): PageSize[] {
  const n = doc.countPages();
  const out: PageSize[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const page = doc.findPage(i);
    let box = page.getInheritable('CropBox');
    if (!box.isArray() || box.length < 4) box = page.getInheritable('MediaBox');
    let w = 612;
    let h = 792;
    if (box.isArray() && box.length >= 4) {
      w = Math.abs(num(box.get(2)) - num(box.get(0))) || 612;
      h = Math.abs(num(box.get(3)) - num(box.get(1))) || 792;
    }
    const rot = ((num(page.getInheritable('Rotate')) % 360) + 360) % 360;
    out[i] = rot === 90 || rot === 270 ? [h, w] : [w, h];
  }
  return out;
}

export function readNotices(doc: mupdf.PDFDocument, wasEncrypted: boolean): PdfNotices {
  const root = doc.getTrailer().get('Root');
  const outlines = root.get('Outlines');
  const acro = root.get('AcroForm');
  const fields = acro.isDictionary() ? acro.get('Fields') : null;
  let isSigned = false;
  if (acro.isDictionary()) {
    const sigFlags = acro.get('SigFlags');
    isSigned = sigFlags.isNumber() && (sigFlags.asNumber() & 1) === 1;
    if (!isSigned && fields?.isArray()) {
      fields.forEach((f) => {
        if (!isSigned && f.get('FT').isName() && f.get('FT').asName() === 'Sig' && !f.get('V').isNull()) isSigned = true;
      });
    }
  }
  return {
    wasRepaired: doc.wasRepaired(),
    hasOutline: outlines.isDictionary() && !outlines.get('First').isNull(),
    hasForm: !!fields && fields.isArray() && fields.length > 0,
    isSigned,
    wasEncrypted,
    restricted: !doc.hasPermission('assemble'),
  };
}

/**
 * Renders a page to an opaque RGBA ImageData of `widthPx` (height follows the page).
 * Uses a 4-channel pixmap cleared to white, so the bytes are straight RGBA with no JS conversion.
 */
export function renderPage(page: mupdf.Page, widthPx: number): ImageData {
  const bounds = page.getBounds();
  const scale = widthPx / Math.max(1, bounds[2] - bounds[0]);
  return renderAtScale(page, scale);
}

export function renderAtScale(page: mupdf.Page, scale: number): ImageData {
  const ctm = mupdf.Matrix.scale(scale, scale);
  const [x0, y0, x1, y1] = mupdf.Rect.transform(page.getBounds(), ctm);
  const bbox: mupdf.Rect = [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true);
  try {
    pix.clear(255);
    const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
    try {
      page.run(dev, ctm);
      dev.close();
    } finally {
      dev.destroy();
    }
    return new ImageData(new Uint8ClampedArray(pix.getPixels()), pix.getWidth(), pix.getHeight());
  } finally {
    pix.destroy();
  }
}

// ---- Image downsampling (Balanced, Strong) --------------------------------------------------------

type XObjectUse = { dict: mupdf.PDFObject; name: string };
type FoundImage = { ref: mupdf.PDFObject; uses: XObjectUse[] };

/** Image XObjects reachable from a resource dictionary, recursing into Form XObjects. */
function collectImages(resources: mupdf.PDFObject, found: Map<number, FoundImage>, seenForms: Set<number>) {
  if (!resources.isDictionary()) return;
  const xobjs = resources.get('XObject');
  if (!xobjs.isDictionary()) return;
  xobjs.forEach((val, name) => {
    if (!val.isIndirect()) return;
    const n = val.asIndirect();
    const subtype = val.get('Subtype');
    const sub = subtype.isName() ? subtype.asName() : '';
    if (sub === 'Image') {
      const e = found.get(n) ?? { ref: val, uses: [] };
      e.uses.push({ dict: xobjs, name: String(name) });
      found.set(n, e);
    } else if (sub === 'Form' && !seenForms.has(n)) {
      seenForms.add(n);
      collectImages(val.get('Resources'), found, seenForms);
    }
  });
}

/**
 * Largest displayed size (points) of each image drawn on the page, keyed by MuPDF image pointer.
 * The Image handles are returned too: the caller destroys them only after matching, so a freed
 * pointer can never be reused by another image while matching is in progress.
 */
function measurePage(page: mupdf.Page): Map<number, { w: number; h: number; image: mupdf.Image }> {
  const sizes = new Map<number, { w: number; h: number; image: mupdf.Image }>();
  const record = (image: mupdf.Image, ctm: mupdf.Matrix) => {
    const w = Math.hypot(ctm[0], ctm[1]);
    const h = Math.hypot(ctm[2], ctm[3]);
    const key = image.pointer as unknown as number;
    const prev = sizes.get(key);
    if (prev) {
      prev.w = Math.max(prev.w, w);
      prev.h = Math.max(prev.h, h);
      image.destroy();
    } else {
      sizes.set(key, { w, h, image });
    }
  };
  const dev = new mupdf.Device({ fillImage: (image, ctm) => record(image, ctm), fillImageMask: (image, ctm) => record(image, ctm) });
  try {
    page.run(dev, mupdf.Matrix.identity);
    dev.close();
  } finally {
    dev.destroy();
  }
  return sizes;
}

/**
 * MuPDF caches images per object, so the pointer the device saw matches loadImage() for the same
 * object. When it does not, assume the image spans the page width: that under-compresses small
 * images but never damages them.
 */
function displayedSize(doc: mupdf.PDFDocument, ref: mupdf.PDFObject, sizes: Map<number, { w: number; h: number }>, pageWidth: number) {
  const img = doc.loadImage(ref);
  try {
    return sizes.get(img.pointer as unknown as number) ?? { w: pageWidth, h: (pageWidth * img.getHeight()) / Math.max(1, img.getWidth()) };
  } finally {
    img.destroy();
  }
}

export type DownsampleStats ={ images: number; replaced: number; bytesBefore: number; bytesAfter: number };

/**
 * Re-encodes every image displayed above ~1.2x the target ppi as a JPEG at the target ppi, in place.
 * An image shared by several pages is processed once and keeps enough pixels for its largest use.
 */
export async function downsampleImages(
  doc: mupdf.PDFDocument,
  opts: { ppi: number; quality: number },
  progress: (done: number, total: number, step: string) => void,
  yieldNow: () => Promise<void>,
): Promise<DownsampleStats> {
  const images = new Map<number, FoundImage & { maxW: number; maxH: number }>();
  const pageCount = doc.countPages();
  const seenForms = new Set<number>();
  for (let i = 0; i < pageCount; i++) {
    progress(i, pageCount, `Measuring images on page ${i + 1} of ${pageCount}`);
    const page = doc.loadPage(i);
    try {
      const found = new Map<number, FoundImage>();
      collectImages(page.getObject().get('Resources'), found, seenForms);
      if (found.size === 0) continue;
      const sizes = measurePage(page);
      try {
        const pageWidth = page.getBounds()[2] - page.getBounds()[0];
        for (const [n, e] of found) {
          const m = displayedSize(doc, e.ref, sizes, pageWidth);
          const cur = images.get(n) ?? { ref: e.ref, uses: [], maxW: 0, maxH: 0 };
          cur.uses.push(...e.uses);
          cur.maxW = Math.max(cur.maxW, m.w);
          cur.maxH = Math.max(cur.maxH, m.h);
          images.set(n, cur);
        }
      } finally {
        for (const m of sizes.values()) m.image.destroy();
      }
    } finally {
      page.destroy();
    }
    await yieldNow();
  }

  const stats: DownsampleStats = { images: images.size, replaced: 0, bytesBefore: 0, bytesAfter: 0 };
  let k = 0;
  for (const e of images.values()) {
    k++;
    progress(k - 1, images.size, `Compressing images ${k} of ${images.size}`);
    await yieldNow();
    const img = doc.loadImage(e.ref);
    try {
      const W = img.getWidth();
      const H = img.getHeight();
      if (e.maxW <= 0 || e.maxH <= 0) continue;
      const effPpi = Math.min(W / (e.maxW / 72), H / (e.maxH / 72));
      if (effPpi <= opts.ppi * 1.2) continue;
      if (img.getImageMask() || img.getBitsPerComponent() === 1) continue;
      if (img.getMask() || !e.ref.get('SMask').isNull() || !e.ref.get('Mask').isNull()) continue;
      const nw = Math.max(1, Math.round((W * opts.ppi) / effPpi));
      const nh = Math.max(1, Math.round((H * opts.ppi) / effPpi));
      const cs = img.getColorSpace();
      const target = cs && cs.isGray() ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
      const jpeg = resampleToJpeg(img, nw, nh, target, opts.quality);
      const oldLen = e.ref.readRawStream().getLength();
      if (jpeg.length >= oldLen) continue;
      const newImg = new mupdf.Image(jpeg);
      try {
        const newRef = doc.addImage(newImg);
        for (const u of e.uses) u.dict.put(u.name, newRef);
      } finally {
        newImg.destroy();
      }
      stats.replaced++;
      stats.bytesBefore += oldLen;
      stats.bytesAfter += jpeg.length;
    } finally {
      img.destroy();
    }
  }
  progress(images.size, images.size, 'Compressing images');
  return stats;
}

/** MuPDF.js 1.28 has no sized Image.toPixmap(); drawing into a target-size pixmap resamples instead. */
function resampleToJpeg(img: mupdf.Image, w: number, h: number, cs: mupdf.ColorSpace, quality: number): Uint8Array {
  const pix = new mupdf.Pixmap(cs, [0, 0, w, h], false);
  try {
    pix.clear(255);
    const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
    try {
      dev.fillImage(img, [w, 0, 0, h, 0, 0], 1);
      dev.close();
    } finally {
      dev.destroy();
    }
    return pix.asJPEG(quality, false).slice();
  } finally {
    pix.destroy();
  }
}

// ---- Scan --------------------------------------------------------------------------------------

/** Rebuilds `src` as image-only pages: each page rendered at `ppi`, JPEG `quality`, same size. */
export async function scanDocument(
  src: mupdf.PDFDocument,
  opts: { ppi: number; quality: number },
  progress: (done: number, total: number, step: string) => void,
  yieldNow: () => Promise<void>,
): Promise<mupdf.PDFDocument> {
  const out = new mupdf.PDFDocument();
  try {
    const n = src.countPages();
    for (let i = 0; i < n; i++) {
      progress(i, n, `Rendering pages ${i + 1} of ${n}`);
      await yieldNow();
      const page = src.loadPage(i);
      try {
        const [x0, y0, x1, y1] = page.getBounds();
        const w = x1 - x0;
        const h = y1 - y0;
        const pix = page.toPixmap(mupdf.Matrix.scale(opts.ppi / 72, opts.ppi / 72), mupdf.ColorSpace.DeviceRGB, false, true);
        let img: mupdf.Image | undefined;
        try {
          img = new mupdf.Image(pix.asJPEG(opts.quality, false));
          const ref = out.addImage(img);
          out.insertPage(-1, out.addPage([0, 0, w, h], 0, { XObject: { Scan: ref } }, `q ${w} 0 0 ${h} 0 0 cm /Scan Do Q`));
        } finally {
          img?.destroy();
          pix.destroy();
        }
      } finally {
        page.destroy();
      }
    }
    progress(n, n, 'Rendering pages');
    return out;
  } catch (e) {
    out.destroy();
    throw e;
  }
}
