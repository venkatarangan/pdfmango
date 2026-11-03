// Drawing and exporting pages that carry edits (fine rotation, crop, photo corners). Untouched
// pages never come here: the engine keeps its original code paths for them.
import * as mupdf from 'mupdf';
import {
  IDENTITY,
  cm,
  concat,
  cropRect,
  editKey,
  invert,
  rotationAbout,
  transformRect,
  userSpaceRotation,
  warpSize,
  apply,
  type Matrix,
  type Rect,
} from '../lib/edits';
import { config } from '../pdfmango.config';
import type { Crop, PageEdit } from '../lib/types';
import type { ImageGeometry } from './layout';
import type { Orientation } from './jpeg';

/** What the engine keeps for a photo page (see engine.ts). */
export type ImageSourceData = { kind: 'image'; doc: mupdf.PDFDocument; imageRef: mupdf.PDFObject; orient: Orientation; geometry: ImageGeometry };

/** A page to draw, with the edits still to be applied while drawing it. */
export type View = { doc: mupdf.PDFDocument; index: number; fine: number; crop?: Crop };

// ---- Photo pages: corners and crops change the pixels ------------------------------------------------

type Derived = ImageSourceData & { key: string; bakedRotation: boolean };
const derived = new Map<string, Derived>(); // insertion order = LRU order
const MAX_DERIVED = 6;
let pinned = false;

/** While an export runs, derived photos stay alive (their graft maps still point at them). */
export function pinDerived(p: boolean) {
  pinned = p;
  if (!p) trimDerived();
}

function trimDerived() {
  if (pinned) return;
  for (const [k, d] of derived) {
    if (derived.size <= MAX_DERIVED) break;
    d.doc.destroy();
    derived.delete(k);
  }
}

/** Forgets the derived photos of one source (or all of them). */
export function dropDerived(sourceId?: string) {
  for (const [k, d] of derived) {
    if (sourceId && !k.startsWith(`${sourceId}|`)) continue;
    d.doc.destroy();
    derived.delete(k);
  }
}

/** True when a photo page's edits need new pixels (a straightened or cut photo). */
export const needsPixels = (e: PageEdit | undefined) => !!(e?.corners || e?.crop);

/**
 * A photo page after Straighten photo (corners) and Split (crop), as a new JPEG held like any photo
 * source. A crop on a photo that is also turned bakes the turn in, so the cut is truly rectangular.
 * The original photo is kept untouched, so Cancel, Undo and editing again all work.
 */
export function derivedImage(sourceId: string, src: ImageSourceData, e: PageEdit): Derived {
  const key = `${sourceId}|${editKey({ corners: e.corners, crop: e.crop, fineRotation: e.crop ? e.fineRotation : undefined })}`;
  const hit = derived.get(key);
  if (hit) {
    derived.delete(key);
    derived.set(key, hit);
    return hit;
  }
  const { maxSidePx, jpegQuality } = config.straightenPhoto;
  let pix = uprightPixels(src);
  try {
    if (e.corners) {
      const [W, H] = [pix.getWidth(), pix.getHeight()];
      const [w, h] = warpSize(e.corners, W, H, maxSidePx);
      const next = pix.warp(e.corners.map(([x, y]) => [x * W, y * H] as mupdf.Point), w, h);
      pix.destroy();
      pix = next;
    }
    if (e.crop) {
      const [W, H] = [pix.getWidth(), pix.getHeight()];
      const r = cropRect([0, 0, W, H], e.crop);
      // Cut corners as they sit in the turned picture, taken back to the unturned one.
      const back = e.fineRotation ? rotationAbout([0, 0, W, H], -e.fineRotation) : IDENTITY;
      const quad = [apply(back, r[0], r[1]), apply(back, r[2], r[1]), apply(back, r[2], r[3]), apply(back, r[0], r[3])] as mupdf.Point[];
      const next = pix.warp(quad, Math.max(1, Math.round(r[2] - r[0])), Math.max(1, Math.round(r[3] - r[1])));
      pix.destroy();
      pix = next;
    }
    const [w, h] = [pix.getWidth(), pix.getHeight()];
    const img = new mupdf.Image(pix.asJPEG(jpegQuality, false));
    const doc = new mupdf.PDFDocument();
    try {
      const imageRef = doc.addImage(img);
      doc.insertPage(-1, doc.addPage([0, 0, w, h], 0, { XObject: { Im0: imageRef } }, `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`));
      const geometry: ImageGeometry = { widthPx: w, heightPx: h, xRes: src.geometry.xRes, yRes: src.geometry.yRes };
      const d: Derived = { kind: 'image', doc, imageRef, orient: 1, geometry, key, bakedRotation: !!e.crop };
      derived.set(key, d);
      trimDerived();
      return d;
    } catch (err) {
      doc.destroy();
      throw err;
    } finally {
      img.destroy();
    }
  } finally {
    pix.destroy();
  }
}

/** The photo upright (EXIF applied), one pixel per pixel, on white. */
function uprightPixels(src: ImageSourceData): mupdf.Pixmap {
  const page = src.doc.loadPage(0);
  try {
    return page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  } finally {
    page.destroy();
  }
}

// ---- Drawing ----------------------------------------------------------------------------------------

/**
 * Draws `view` with its turn and crop; `after` maps the page's drawing space to pixels (scale,
 * then any added rotation). Returns a pixmap of just the visible area, on white.
 */
export function drawView(view: View, after: Matrix, cs: mupdf.ColorSpace, alpha: boolean): mupdf.Pixmap {
  const page = view.doc.loadPage(view.index);
  try {
    const b = page.getBounds() as Rect;
    const region = view.crop ? cropRect(b, view.crop) : b;
    const turn = view.fine ? rotationAbout(b, view.fine) : IDENTITY;
    const [x0, y0, x1, y1] = transformRect(region, after);
    const bbox: mupdf.Rect = [Math.floor(x0 + 1e-6), Math.floor(y0 + 1e-6), Math.max(Math.floor(x0 + 1e-6) + 1, Math.ceil(x1 - 1e-6)), Math.max(Math.floor(y0 + 1e-6) + 1, Math.ceil(y1 - 1e-6))];
    const pix = new mupdf.Pixmap(cs, bbox, alpha);
    try {
      pix.clear(255);
      const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
      try {
        page.run(dev, concat(turn, after) as mupdf.Matrix);
        dev.close();
      } finally {
        dev.destroy();
      }
      return pix;
    } catch (err) {
      pix.destroy();
      throw err;
    }
  } finally {
    page.destroy();
  }
}

/** Size of the visible area of a view, in the page's drawing units. */
export function viewSize(view: View): [number, number] {
  const page = view.doc.loadPage(view.index);
  try {
    const b = page.getBounds() as Rect;
    const r = view.crop ? cropRect(b, view.crop) : b;
    return [Math.max(1, r[2] - r[0]), Math.max(1, r[3] - r[1])];
  } finally {
    page.destroy();
  }
}

/** Width of the visible area of a view, in the page's drawing units. */
export function viewWidth(view: View): number {
  const page = view.doc.loadPage(view.index);
  try {
    const b = page.getBounds() as Rect;
    const r = view.crop ? cropRect(b, view.crop) : b;
    return Math.max(1, r[2] - r[0]);
  } finally {
    page.destroy();
  }
}

// ---- Export: PDF pages ----------------------------------------------------------------------------

/**
 * Applies a turn and a crop to a page just grafted into `out` (before its /Rotate is changed).
 * The turn wraps the content in `q … cm … Q`, so text stays text; the crop sets /MediaBox and
 * /CropBox (the hidden part stays in the file, as in any cropped PDF).
 */
export function editGraftedPage(out: mupdf.PDFDocument, index: number, pageObj: mupdf.PDFObject, e: PageEdit) {
  const page = out.loadPage(index);
  let T: Matrix;
  let b: Rect;
  try {
    T = page.getTransform() as Matrix;
    b = page.getBounds() as Rect;
  } finally {
    page.destroy();
  }
  if (e.fineRotation) wrapContents(out, pageObj, cm(userSpaceRotation(T, b, e.fineRotation)));
  if (e.crop) {
    const r = transformRect(cropRect(b, e.crop), invert(T));
    const box = () => {
      const a = out.newArray();
      for (const n of r) a.push(Number(n.toFixed(4)));
      return a;
    };
    pageObj.put('MediaBox', box());
    pageObj.put('CropBox', box());
    for (const k of ['TrimBox', 'BleedBox', 'ArtBox']) pageObj.delete(k);
  }
}

function wrapContents(out: mupdf.PDFDocument, pageObj: mupdf.PDFObject, op: string) {
  const old = pageObj.get('Contents');
  if (old.isNull()) return;
  const arr = out.newArray();
  arr.push(out.addStream(`q ${op}\n`, {}));
  if (old.isArray()) old.forEach((o) => arr.push(o));
  else arr.push(old);
  arr.push(out.addStream('\nQ', {}));
  pageObj.put('Contents', arr);
}

/** Content for a photo page turned by `deg` about its centre (a page with no /Rotate of its own). */
export function turnedImageContent(content: string, pageW: number, pageH: number, deg: number): string {
  const T: Matrix = [1, 0, 0, -1, 0, pageH]; // user space (y up) to drawing space (y down)
  return `q ${cm(userSpaceRotation(T, [0, 0, pageW, pageH], deg))}\n${content}\nQ`;
}
