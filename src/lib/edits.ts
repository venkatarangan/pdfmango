// Page edits (fine rotation, crop, photo corners): pure helpers shared by the main thread and the
// worker. Matrices use MuPDF's row-vector form [a, b, c, d, e, f]: (x, y) -> (ax + cy + e, bx + dy + f).
import type { Crop, PageEdit, PageRef, PageSize, Quad, Rotation } from './types';

export type Matrix = [number, number, number, number, number, number];
export type Rect = [x0: number, y0: number, x1: number, y1: number];

/** The page's edits, or undefined for an untouched page (which then takes the original code paths). */
export function editOf(p: PageRef): PageEdit | undefined {
  const e: PageEdit = {};
  if (p.fineRotation) e.fineRotation = p.fineRotation;
  if (p.crop) e.crop = p.crop;
  if (p.corners) e.corners = p.corners;
  return e.fineRotation || e.crop || e.corners ? e : undefined;
}

/** A short stable key for caching renders of an edited page ('' when untouched). */
export function editKey(e: PageEdit | undefined): string {
  if (!e) return '';
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  const parts: string[] = [];
  if (e.corners) parts.push('q' + e.corners.flat().map(r).join(','));
  if (e.fineRotation) parts.push('r' + r(e.fineRotation));
  if (e.crop) parts.push('c' + [e.crop.x0, e.crop.y0, e.crop.x1, e.crop.y1].map(r).join(','));
  return parts.join('|');
}

/** Rounds an angle to 0.01° and drops anything that would round to no rotation. */
export function cleanAngle(deg: number): number {
  const r = Math.round(deg * 100) / 100;
  return Math.abs(r) < 0.01 ? 0 : r;
}

/** Sets (or, for 0, removes) a page's fine rotation. */
export function withFineRotation(p: PageRef, deg: number): PageRef {
  const angle = cleanAngle(deg);
  if (angle === (p.fineRotation ?? 0)) return p;
  const { fineRotation: _, ...rest } = p;
  return angle ? { ...rest, fineRotation: angle } : rest;
}

/** Sets the fine rotation of the pages in `angles` (uid -> degrees); one undoable edit. */
export function setFineRotations(pages: readonly PageRef[], angles: ReadonlyMap<string, number>): PageRef[] {
  let changed = false;
  const out = pages.map((p) => {
    const a = angles.get(p.uid);
    if (a === undefined) return p;
    const q = withFineRotation(p, a);
    if (q !== p) changed = true;
    return q;
  });
  return changed ? out : (pages as PageRef[]);
}

// ---- Matrices --------------------------------------------------------------------------------------

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a then b. */
export function concat(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  return [a, b, c, d, -m[4] * a - m[5] * c, -m[4] * b - m[5] * d];
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Bounding box of a rectangle after a transform. */
export function transformRect(r: Rect, m: Matrix): Rect {
  const pts = [apply(m, r[0], r[1]), apply(m, r[2], r[1]), apply(m, r[2], r[3]), apply(m, r[0], r[3])];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Turns content clockwise by `deg` (as seen on screen, y down) about the centre of `bounds`,
 * in the page's drawing space (y down, original /Rotate already applied).
 */
export function rotationAbout(bounds: Rect, deg: number): Matrix {
  const cx = (bounds[0] + bounds[2]) / 2;
  const cy = (bounds[1] + bounds[3]) / 2;
  const t = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

/**
 * The same turn expressed in PDF user space, for a `cm` operator wrapped round the page content.
 * `pageTransform` maps user space to drawing space (MuPDF's PDFPage.getTransform()).
 */
export function userSpaceRotation(pageTransform: Matrix, bounds: Rect, deg: number): Matrix {
  return concat(concat(pageTransform, rotationAbout(bounds, deg)), invert(pageTransform));
}

/** A crop (0..1) as a rectangle in drawing space. */
export function cropRect(bounds: Rect, c: Crop): Rect {
  const w = bounds[2] - bounds[0];
  const h = bounds[3] - bounds[1];
  return [bounds[0] + c.x0 * w, bounds[1] + c.y0 * h, bounds[0] + c.x1 * w, bounds[1] + c.y1 * h];
}

/** Formats a matrix for a content stream. */
export function cm(m: Matrix): string {
  return m.map((n) => (Math.abs(n) < 1e-9 ? 0 : Number(n.toFixed(6)))).join(' ') + ' cm';
}

// ---- Sizes ---------------------------------------------------------------------------------------

/** Output size of a flattened photo: the average lengths of opposite edges, long side capped. */
export function warpSize(q: Quad, widthPx: number, heightPx: number, maxSide: number): [number, number] {
  const d = (a: number, b: number) => Math.hypot((q[a][0] - q[b][0]) * widthPx, (q[a][1] - q[b][1]) * heightPx);
  let w = (d(0, 1) + d(3, 2)) / 2;
  let h = (d(0, 3) + d(1, 2)) / 2;
  const s = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * s));
  h = Math.max(1, Math.round(h * s));
  return [w, h];
}

/**
 * Size of a page as drawn before any added rotation, after its edits. `base` is the source page's
 * size (for photos, in pixels, which PDFMango draws at 1 px = 1 pt).
 */
export function editedSize(base: PageSize, e: PageEdit | undefined, maxSide: number): PageSize {
  let [w, h] = base;
  if (e?.corners) [w, h] = warpSize(e.corners, w, h, maxSide);
  if (e?.crop) [w, h] = [w * (e.crop.x1 - e.crop.x0), h * (e.crop.y1 - e.crop.y0)];
  return [w, h];
}

/** The same size as it shows on screen, with the added rotation. */
export function shownSize(base: PageSize, e: PageEdit | undefined, rotation: Rotation, maxSide: number): PageSize {
  const [w, h] = editedSize(base, e, maxSide);
  return rotation % 180 ? [h, w] : [w, h];
}

// ---- Straighten photo ------------------------------------------------------------------------------

/** Where the corner handles start: 5% in from each edge. */
export const DEFAULT_CORNERS: Quad = [
  [0.05, 0.05],
  [0.95, 0.05],
  [0.95, 0.95],
  [0.05, 0.95],
];

/** Sets (or, with undefined, removes) the corners of a photo page. One undoable edit. */
export function setCorners(pages: readonly PageRef[], uid: string, corners: Quad | undefined): PageRef[] {
  let changed = false;
  const out = pages.map((p) => {
    if (p.uid !== uid) return p;
    if (editKey({ corners }) === editKey({ corners: p.corners })) return p;
    changed = true;
    const { corners: _, ...rest } = p;
    return corners ? { ...rest, corners: corners.map(([x, y]) => [clamp01(x), clamp01(y)]) as Quad } : rest;
  });
  return changed ? out : (pages as PageRef[]);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** True when four corners make a usable outline: convex, in order, and not too small. */
export function isUsableQuad(q: Quad, widthPx: number, heightPx: number): boolean {
  const pts = q.map(([x, y]) => [x * widthPx, y * heightPx]);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-6) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  const [w, h] = warpSize(q, widthPx, heightPx, Infinity);
  return w >= 16 && h >= 16;
}
