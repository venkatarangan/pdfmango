// Geometry for image pages. Pure math, shared by the worker and the unit tests.
import type { Orientation } from './jpeg';
import type { ImagePageSize } from '../lib/types';

export type Matrix = [number, number, number, number, number, number];
export const A4: [number, number] = [595.28, 841.89];

/** Stored pixel (s right, t down, 0..1) -> displayed position (X right, Y down) for each EXIF orientation. */
const ORIENT: Record<Orientation, (s: number, t: number) => [number, number]> = {
  1: (s, t) => [s, t],
  2: (s, t) => [1 - s, t],
  3: (s, t) => [1 - s, 1 - t],
  4: (s, t) => [s, 1 - t],
  5: (s, t) => [t, s],
  6: (s, t) => [1 - t, s],
  7: (s, t) => [1 - t, 1 - s],
  8: (s, t) => [t, 1 - s],
};

export const swapsAxes = (o: Orientation) => o >= 5;

/**
 * The PDF `cm` matrix that paints an image XObject (unit square, first row at the top) upright
 * into the rectangle x, y, w, h (PDF user space, y up), undoing the EXIF orientation.
 */
export function orientedMatrix(o: Orientation, x: number, y: number, w: number, h: number): Matrix {
  const T = ORIENT[o] ?? ORIENT[1];
  // Image space: u = s, v = 1 - t. Page point = (x + w·X, y + h·(1 − Y)).
  const P = (u: number, v: number): [number, number] => {
    const [X, Y] = T(u, 1 - v);
    return [x + w * X, y + h * (1 - Y)];
  };
  const [e, f] = P(0, 0);
  const [ax, ay] = P(1, 0);
  const [cx, cy] = P(0, 1);
  return [ax - e, ay - f, cx - e, cy - f, e, f];
}

export type ImageGeometry = {
  /** Displayed size in pixels, after EXIF orientation. */
  widthPx: number;
  heightPx: number;
  /** Pixels per inch along the displayed axes (already swapped for rotated photos). */
  xRes: number;
  yRes: number;
};

export type ImagePageLayout = { pageW: number; pageH: number; x: number; y: number; w: number; h: number };

/** Images with no usable resolution are treated as 96 ppi (1 px = 0.75 pt). */
export const usableRes = (r: number) => (Number.isFinite(r) && r >= 10 && r <= 10000 ? r : 96);

/**
 * A4: orientation follows the image, image fitted inside the margin, centred.
 * Original: page = image size at its own resolution, plus the margin on every side.
 */
export function imagePageLayout(g: ImageGeometry, size: ImagePageSize, marginPt: number): ImagePageLayout {
  if (size === 'A4') {
    const [pageW, pageH] = g.widthPx > g.heightPx ? [A4[1], A4[0]] : A4;
    const scale = Math.min((pageW - 2 * marginPt) / g.widthPx, (pageH - 2 * marginPt) / g.heightPx);
    const w = g.widthPx * scale;
    const h = g.heightPx * scale;
    return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
  }
  const w = (g.widthPx * 72) / usableRes(g.xRes);
  const h = (g.heightPx * 72) / usableRes(g.yRes);
  return { pageW: w + 2 * marginPt, pageH: h + 2 * marginPt, x: marginPt, y: marginPt, w, h };
}

/** Content stream that draws image resource `name` into the layout's rectangle. */
export function imagePageContent(o: Orientation, l: ImagePageLayout, name = 'Im0'): string {
  const m = orientedMatrix(o, l.x, l.y, l.w, l.h).map((n) => +n.toFixed(4));
  return `q ${m.join(' ')} cm /${name} Do Q`;
}
