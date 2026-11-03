// Finds the spine of a two-page book spread from column projection profiles. Plain TypeScript on a
// greyscale render (see projection.ts), so it is easy to test.
import { otsu, type Gray } from './projection';

export type Gutter = {
  /** Spine position, 0..1 across the page. */
  at: number;
  /** How far the spine stands out from the columns around it (a z-score). */
  z: number;
  kind: 'shadow' | 'gap' | 'crease';
};

export type SpreadAnalysis = {
  /** At least `minAspect` times wider than tall. */
  landscape: boolean;
  /** Both halves carry ink. */
  bothHalves: boolean;
  gutter: Gutter;
  /**
   * Spine found separately in the top and bottom thirds: top minus bottom, as a share of the
   * width. 0 when either third has no clear spine of its own (too little on it to tell).
   */
  slant: number;
};

export type SpreadOptions = { minAspect: number; band: readonly [number, number]; minConfidence: number };

/** Running mean over a window of `k` (odd) values. */
function smooth(a: Float64Array, k: number): Float64Array {
  const out = new Float64Array(a.length);
  const h = k >> 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length + h; i++) {
    if (i < a.length) (sum += a[i]), n++;
    if (i - k >= 0) (sum -= a[i - k]), n--;
    const j = i - h;
    if (j >= 0 && j < a.length) out[j] = sum / n;
  }
  return out;
}

function meanStd(a: ArrayLike<number>, from: number, to: number, skip: [number, number]) {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let i = from; i < to; i++) {
    if (i >= skip[0] && i <= skip[1]) continue;
    s += a[i];
    s2 += a[i] * a[i];
    n++;
  }
  const m = n ? s / n : 0;
  return { mean: m, std: n ? Math.sqrt(Math.max(0, s2 / n - m * m)) : 0 };
}

/**
 * The spine within the middle band, using rows y0..y1: either the darkest column (a shadow in the
 * fold) or the middle of the widest run of empty columns (a white gap), whichever stands out more.
 */
export function findGutter(g: Gray, band: readonly [number, number], y0 = 0, y1 = g.height, threshold = otsu(g)): Gutter {
  const { width: w, data } = g;
  const bright = new Float64Array(w);
  const ink = new Float64Array(w);
  const rows = Math.max(1, y1 - y0);
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const v = data[row + x];
      bright[x] += v;
      if (v <= threshold) ink[x]++;
    }
  }
  for (let x = 0; x < w; x++) {
    bright[x] /= rows;
    ink[x] /= rows;
  }
  const k = Math.max(3, Math.round(w / 200) | 1);
  const B = smooth(bright, k);
  const I = smooth(ink, k);
  const b0 = Math.max(0, Math.floor(band[0] * w));
  const b1 = Math.min(w, Math.ceil(band[1] * w));
  const guard = Math.max(3, Math.round(w * 0.02)); // columns left out round a candidate when measuring its neighbours

  // Shadow: the darkest column. A spine is darker than the paper on both sides of it, so it is
  // measured against the dimmer side (a dark area on one side only, as in a photo, scores low).
  let xs = b0;
  for (let x = b0; x < b1; x++) if (B[x] < B[xs]) xs = x;
  const ns = meanStd(B, b0, b1, [xs - guard, xs + guard]);
  const reach = Math.max(guard, Math.round(w * 0.06));
  const sideL = meanStd(B, Math.max(0, xs - guard - reach), Math.max(0, xs - guard), [-1, -1]).mean;
  const sideR = meanStd(B, Math.min(w, xs + guard + 1), Math.min(w, xs + guard + 1 + reach), [-1, -1]).mean;
  const zShadow = (Math.min(sideL, sideR) - B[xs]) / Math.max(1, ns.std);

  // Gap: the widest run of (nearly) empty columns, against the ink of the columns beside it.
  let peak = 0;
  for (let x = b0; x < b1; x++) peak = Math.max(peak, I[x]);
  const empty = Math.max(0.002, peak * 0.08);
  let best: [number, number] | null = null;
  for (let x = b0; x < b1; ) {
    if (I[x] > empty) {
      x++;
      continue;
    }
    let e = x;
    while (e < b1 && I[e] <= empty) e++;
    if (!best || e - x > best[1] - best[0]) best = [x, e - 1];
    x = e;
  }
  let zGap = 0;
  let xg = Math.round((b0 + b1) / 2);
  if (best) {
    xg = Math.round((best[0] + best[1]) / 2);
    // The run must be closed in by ink on both sides, or it is just a margin.
    const side = Math.max(guard, Math.round(w * 0.05));
    const left = meanStd(I, Math.max(0, best[0] - side), best[0], [-1, -1]);
    const right = meanStd(I, best[1] + 1, Math.min(w, best[1] + 1 + side), [-1, -1]);
    const runInk = meanStd(I, best[0], best[1] + 1, [-1, -1]).mean;
    const closed = Math.min(left.mean, right.mean) - runInk;
    const noise = Math.max(0.004, (left.std + right.std) / 2);
    // A wider gap is a surer gap; scale by width relative to a typical 1% spine.
    zGap = (closed / noise) * Math.min(2, Math.sqrt((best[1] - best[0] + 1) / Math.max(1, w * 0.01)));
  }
  const crease = findCrease(g, b0, b1, y0, y1, threshold);
  const found: Gutter =
    zShadow >= zGap ? { at: (xs + 0.5) / w, z: zShadow, kind: 'shadow' } : { at: (xg + 0.5) / w, z: zGap, kind: 'gap' };
  return crease.z > found.z ? crease : found;
}

/** Shortest share of rows a fold must cross: it runs down nearly the whole page. */
const CREASE_MIN_SHARE = 0.4;

/**
 * The fold of an open book in a photo: in each row, either a narrow dip darker than the paper a
 * little way to both sides, or a clean step between two flat stretches of paper (the two pages
 * catch the light differently). A fold lines up in one place across most rows, allowing for a
 * little slant; text, pictures and photo texture do not.
 */
function findCrease(g: Gray, b0: number, b1: number, y0: number, y1: number, threshold: number): Gutter {
  const { width: w, data } = g;
  const r = Math.max(4, Math.round(w * 0.012)); // how far away the paper on each side is looked at
  const votes = new Float64Array(w);
  const row = new Float64Array(w);
  let rows = 0;
  const flat = (from: number, to: number) => {
    let s = 0;
    let s2 = 0;
    for (let x = from; x < to; x++) (s += row[x]), (s2 += row[x] * row[x]);
    const n = to - from;
    const m = s / n;
    return { m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)) };
  };
  for (let y = y0; y < y1; y += 2) {
    const o = y * w;
    // Light smoothing along the row, so single noisy pixels do not count.
    for (let x = 1; x < w - 1; x++) row[x] = (data[o + x - 1] + 2 * data[o + x] + data[o + x + 1]) / 4;
    rows++;
    const lo = Math.max(r + 2, b0);
    const hi = Math.min(w - r - 2, b1);
    let voted = -1;
    for (let x = lo; x < hi; x++) {
      const v = row[x];
      // A dip: the darkest point nearby, clearly darker than the paper on both sides.
      if (v <= row[x - 1] && v <= row[x + 1] && v <= row[x - 2] && v <= row[x + 2]) {
        const side = Math.min((row[x - r] + row[x - r - 1]) / 2, (row[x + r] + row[x + r + 1]) / 2);
        if (side - v > 12 && v < 230) {
          votes[x]++;
          voted = x;
          continue;
        }
      }
      // A step between two flat stretches of paper.
      if (x - voted > r) {
        const L = flat(x - r, x - 1);
        const R = flat(x + 2, x + r + 1);
        if (Math.abs(R.m - L.m) > 14 && L.sd < 5 && R.sd < 5 && Math.min(L.m, R.m) > 120) {
          votes[x]++;
          voted = x;
        }
      }
    }
  }
  if (rows === 0) return { at: 0.5, z: 0, kind: 'crease' };
  // A fold may slant a little (photos have perspective): count votes over a window of about 2%.
  const k = Math.max(3, Math.round(w * 0.02) | 1);
  const share = smooth(votes, k);
  for (let x = 0; x < w; x++) share[x] = Math.min(1, (share[x] * k) / rows);
  let xc = b0;
  for (let x = b0; x < b1; x++) if (share[x] > share[xc]) xc = x;
  if (share[xc] < CREASE_MIN_SHARE) return { at: (xc + 0.5) / w, z: 0, kind: 'crease' };
  // Where the votes are thickest within the window (the window is wider than the fold).
  let sum = 0;
  let wsum = 0;
  for (let x = Math.max(0, xc - (k >> 1)); x <= Math.min(w - 1, xc + (k >> 1)); x++) (sum += votes[x] * x), (wsum += votes[x]);
  const at = wsum ? sum / wsum : xc;
  // A book has paper on both sides of the fold; an edge inside a photo does not.
  const paper = (from: number, to: number) => {
    let light = 0;
    let all = 0;
    for (let y = y0; y < y1; y += 2) {
      const o = y * w;
      for (let x = Math.max(0, from); x < Math.min(w, to); x++) {
        all++;
        if (data[o + x] > threshold) light++;
      }
    }
    return all ? light / all : 0;
  };
  const near = Math.round(w * 0.01);
  const far = Math.round(w * 0.06);
  if (paper(Math.round(at) - far, Math.round(at) - near) < 0.6 || paper(Math.round(at) + near, Math.round(at) + far) < 0.6) {
    return { at: (at + 0.5) / w, z: 0, kind: 'crease' };
  }
  const n = meanStd(share, b0, b1, [xc - k, xc + k]);
  return { at: (at + 0.5) / w, z: (share[xc] - n.mean) / Math.max(0.03, n.std), kind: 'crease' };
}

/** Everything Split book spreads needs to decide about one page. */
export function analyseSpread(g: Gray, opts: SpreadOptions): SpreadAnalysis {
  const { width: w, height: h, data } = g;
  const threshold = otsu(g);
  const landscape = w >= opts.minAspect * h;
  const y0 = Math.round(h * 0.05);
  const y1 = Math.round(h * 0.95);
  const gutter = findGutter(g, opts.band, y0, y1, threshold);
  const third = Math.round((y1 - y0) / 3);
  const top = findGutter(g, opts.band, y0, y0 + third, threshold);
  const bottom = findGutter(g, opts.band, y1 - third, y1, threshold);

  // Ink on each side of the spine (leaving out 2% round it), as a share of that side's area.
  const cut = Math.round(gutter.at * w);
  const pad = Math.round(w * 0.02);
  let inkL = 0;
  let inkR = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (data[row + x] > threshold) continue;
      if (x < cut - pad) inkL++;
      else if (x > cut + pad) inkR++;
    }
  }
  const rows = y1 - y0;
  const share = (n: number, cols: number) => n / Math.max(1, rows * cols);
  const bothHalves = share(inkL, cut - pad) > 0.003 && share(inkR, w - cut - pad) > 0.003;
  const slant = top.z >= opts.minConfidence && bottom.z >= opts.minConfidence ? top.at - bottom.at : 0;
  return { landscape, bothHalves, gutter, slant };
}
