// Finding the sheet in a photo (Straighten photo's corners) and a page's content (Crop's Auto).
// Plain TypeScript on greyscale renders, so it is easy to test. No OpenCV: the paper is the
// largest light area, and its corners come from the outline of that area.
import { otsu, type Gray } from './projection';
import type { Crop, Point, Quad } from '../lib/types';

// ---- The sheet in a photo ------------------------------------------------------------------------

/** Light pixels joined to each other, from a flood fill. */
type Region = { size: number; mask: Uint8Array };

/**
 * The largest group of light pixels (4-connected). A second large group right beside it joins it:
 * that is the other page of an open book, cut off by the dark fold between them.
 */
function largestLightRegion(light: Uint8Array, w: number, h: number): Region | null {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const sizes: number[] = [0];
  const boxes: [number, number, number, number][] = [[0, 0, 0, 0]];
  let next = 1;
  for (let i = 0; i < light.length; i++) {
    if (!light[i] || label[i]) continue;
    let size = 0;
    let top = 0;
    const box: [number, number, number, number] = [w, h, -1, -1];
    stack[top++] = i;
    label[i] = next;
    while (top) {
      const p = stack[--top];
      size++;
      const x = p % w;
      const y = (p - x) / w;
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
      const neighbours = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of neighbours) {
        if (q < 0 || q >= light.length || !light[q] || label[q]) continue;
        label[q] = next;
        stack[top++] = q;
      }
    }
    sizes.push(size);
    boxes.push(box);
    next++;
  }
  if (next === 1) return null;
  const order = sizes.map((s, l) => [s, l] as [number, number]).slice(1).sort((a, b) => b[0] - a[0]);
  const keep = new Set([order[0][1]]);
  let size = order[0][0];
  const second = order[1];
  if (second && second[0] >= order[0][0] * 0.3) {
    const [a, b] = [boxes[order[0][1]], boxes[second[1]]];
    const gapX = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]));
    const gapY = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
    if (gapX <= w * 0.06 && gapY <= h * 0.06) {
      keep.add(second[1]);
      size += second[0];
    }
  }
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) if (keep.has(label[i])) mask[i] = 1;
  return { size, mask };
}

/** Convex hull of points (monotone chain), counter-clockwise in y-down screen terms. */
function hull(pts: Point[]): Point[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const area = (q: Point[]) => {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const [a, b] = [q[i], q[(i + 1) % q.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
};

/** The four hull points that enclose the most area (the sheet's corners). */
function biggestQuad(h: Point[]): Point[] {
  // Thin the hull to at most 48 points, spread evenly, so the search stays quick.
  const step = Math.max(1, Math.ceil(h.length / 48));
  const c = h.filter((_, i) => i % step === 0);
  const n = c.length;
  if (n < 4) return c;
  let best: Point[] = [];
  let bestArea = -1;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let d = b + 1; d < n; d++)
        for (let e = d + 1; e < n; e++) {
          const q = [c[a], c[b], c[d], c[e]];
          const s = area(q);
          if (s > bestArea) [bestArea, best] = [s, q];
        }
  return best;
}

/** Puts four corners in the order top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(q: Point[]): Quad {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4;
  const cy = q.reduce((s, p) => s + p[1], 0) / 4;
  // Clockwise on screen from the top-left: sort by angle round the centre, start nearest top-left.
  const sorted = [...q].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i][0] + sorted[i][1] < sorted[start][0] + sorted[start][1]) start = i;
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]) as Quad;
}

export type SheetResult = { corners: Quad; share: number } | null;

/**
 * The corners of the sheet in a photo, 0..1 across the photo, or null when no sheet stands out:
 * the paper must be the largest light area, cover 12–97% of the photo, and fill most of its outline.
 */
export function findSheet(g: Gray): SheetResult {
  const { width: w, height: h, data } = g;
  const t = otsu(g);
  const light = new Uint8Array(w * h);
  for (let i = 0; i < light.length; i++) light[i] = data[i] > t ? 1 : 0;
  const region = largestLightRegion(light, w, h);
  if (!region) return null;
  const share = region.size / (w * h);
  if (share < 0.12 || share > 0.97) return null;
  // The outline: the left- and right-most light pixel of each row of the region.
  const pts: Point[] = [];
  for (let y = 0; y < h; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < w; x++) {
      if (!region.mask[y * w + x]) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    if (lo >= 0) pts.push([lo, y], [hi + 1, y]);
  }
  const outline = hull(pts);
  const quad = biggestQuad(outline);
  if (quad.length !== 4) return null;
  // Paper fills its outline (text and pictures are holes inside it, which is fine); a stray
  // light patch of floor or wall does not look like a four-cornered sheet.
  const fill = region.size / Math.max(1, area(quad));
  if (fill < 0.55) return null;
  const corners = orderCorners(quad).map(([x, y]) => [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]) as Quad;
  // Corners on the photo's own corners mean the page fills the photo: nothing to suggest.
  const frame = [[0, 0], [1, 0], [1, 1], [0, 1]];
  if (corners.every(([x, y], i) => Math.abs(x - frame[i][0]) < 0.03 && Math.abs(y - frame[i][1]) < 0.03)) return null;
  return { corners, share };
}

// ---- Content of a page (Crop's Auto) ------------------------------------------------------------

/**
 * A crop that keeps what matters on a page, 0..1, or null when there is nothing worth cutting.
 * A page lying on something darker (a table, a scanner lid) is cut to the paper; a clean page is
 * cut to its content, with a small margin.
 */
export function findContent(g: Gray): Crop | null {
  const { width: w, height: h, data } = g;
  const t = otsu(g);
  // 1. The paper: step in from each edge past columns, then rows, that are mostly dark (a table,
  // a scanner lid). Only the edges are looked at, so a big dark heading inside the page is fine.
  const colLight = new Float64Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] > t) colLight[x]++;
  let px0 = 0;
  let px1 = w - 1;
  while (px0 < w && colLight[px0] / h < 0.5) px0++;
  while (px1 > px0 && colLight[px1] / h < 0.5) px1--;
  if (px1 <= px0) return null;
  const rowLight = new Float64Array(h);
  for (let y = 0; y < h; y++) for (let x = px0; x <= px1; x++) if (data[y * w + x] > t) rowLight[y]++;
  const cols = px1 - px0 + 1;
  let py0 = 0;
  let py1 = h - 1;
  while (py0 < h && rowLight[py0] / cols < 0.5) py0++;
  while (py1 > py0 && rowLight[py1] / cols < 0.5) py1--;
  if (py1 <= py0) return null;
  const paper: Crop = { x0: px0 / w, y0: py0 / h, x1: (px1 + 1) / w, y1: (py1 + 1) / h };
  const framed = paper.x0 > 0.02 || paper.y0 > 0.02 || paper.x1 < 0.98 || paper.y1 < 0.98;
  if (framed && (paper.x1 - paper.x0) * (paper.y1 - paper.y0) > 0.1) return keep(paper, 0.004);

  // 2. A clean page: the ink, ignoring specks (the outer 0.3% of ink on each side), plus a margin.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[y * w + x] <= t) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < 50) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.floor(f * a.length)))];
  const m = 0.03; // margin, as a share of the page
  return keep({ x0: q(xs, 0.003) / w - m, y0: q(ys, 0.003) / h - m, x1: (q(xs, 0.997) + 1) / w + m, y1: (q(ys, 0.997) + 1) / h + m }, 0);
}

/** Clamps a crop to the page and moves it in by `inset`; null when it would keep almost everything. */
function keep(c: Crop, inset: number): Crop | null {
  const r = {
    x0: Math.max(0, c.x0 + inset),
    y0: Math.max(0, c.y0 + inset),
    x1: Math.min(1, c.x1 - inset),
    y1: Math.min(1, c.y1 - inset),
  };
  if (r.x1 - r.x0 < 0.05 || r.y1 - r.y0 < 0.05) return null;
  return (r.x1 - r.x0) * (r.y1 - r.y0) > 0.97 ? null : r;
}
