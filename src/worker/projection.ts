// Projection profiles on greyscale page renders: finds how much a page is tilted (Straighten) and
// where the spine of a book spread is (Split). Plain TypeScript, no MuPDF, so it is easy to test.

export type Gray = { data: Uint8Array; width: number; height: number };

/** Converts packed RGB or RGBA (or grey) samples to one byte per pixel. */
export function toGray(samples: ArrayLike<number>, width: number, height: number, components: number): Gray {
  const data = new Uint8Array(width * height);
  if (components === 1) data.set(samples as ArrayLike<number>);
  else {
    for (let i = 0, j = 0; i < data.length; i++, j += components) {
      data[i] = (samples[j] * 77 + samples[j + 1] * 150 + samples[j + 2] * 29) >> 8;
    }
  }
  return { data, width, height };
}

/** Otsu's threshold: the grey level that best separates ink from paper. */
export function otsu(g: Gray): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const total = g.data.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Dark (ink) pixels as coordinates about the centre of the page, thinned to at most `max`. */
export function inkPoints(g: Gray, threshold: number, max = 120_000) {
  let n = 0;
  for (let i = 0; i < g.data.length; i++) if (g.data[i] <= threshold) n++;
  const step = Math.max(1, Math.ceil(n / max));
  const count = Math.floor(n / step);
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const cx = g.width / 2;
  const cy = g.height / 2;
  let k = 0;
  let seen = 0;
  for (let y = 0; y < g.height && k < count; y++) {
    const row = y * g.width;
    for (let x = 0; x < g.width; x++) {
      if (g.data[row + x] > threshold) continue;
      if (seen++ % step === 0 && k < count) {
        xs[k] = x - cx;
        ys[k] = y - cy;
        k++;
      }
    }
  }
  return { xs, ys, count: k, inkShare: n / g.data.length };
}

/**
 * How sharply the ink lines up into rows when the page is turned back by `deg`: the sum of
 * squared row counts. Lines of text give tall, narrow peaks, so the right angle scores highest.
 */
export function rowScore(xs: Float32Array, ys: Float32Array, count: number, deg: number, bins: Int32Array, half: number): number {
  const t = (deg * Math.PI) / 180;
  const s = Math.sin(t);
  const c = Math.cos(t);
  bins.fill(0);
  for (let i = 0; i < count; i++) {
    const r = Math.round(ys[i] * c - xs[i] * s) + half;
    bins[r]++;
  }
  let score = 0;
  for (let i = 0; i < bins.length; i++) score += bins[i] * bins[i];
  return score;
}

export type SkewResult = {
  /** Clockwise tilt of the content in degrees (turn the page by -angle to straighten it); 0 when straight or unsure. */
  angle: number;
  /** 'tilted' (angle found), 'straight' (within 0.05°), or 'unsure' (too little text, or no clear best angle). */
  verdict: 'tilted' | 'straight' | 'unsure';
  /** Best score over the score at 0°. */
  gain: number;
};

export type SkewOptions = {
  maxAngle?: number;
  /** The best angle must beat 0° by this factor. */
  minGain?: number;
  /** The best angle must beat the average of all tried angles by this factor (a sharp peak, not a flat one). */
  minPeak?: number;
};

/**
 * Finds the tilt of the text lines: Otsu, then a coarse search (0.5° steps) and a fine search
 * (0.05° steps) for the angle whose row profile is sharpest. Returns 0 rather than guess.
 */
export function detectSkew(g: Gray, opts: SkewOptions = {}): SkewResult {
  const { maxAngle = 15, minGain = 1.08, minPeak = 1.25 } = opts;
  const unsure: SkewResult = { angle: 0, verdict: 'unsure', gain: 1 };
  const threshold = otsu(g);
  const { xs, ys, count, inkShare } = inkPoints(g, threshold);
  // A page with almost no ink, or mostly dark (a photo), has no lines to straighten by.
  if (count < 500 || inkShare < 0.002 || inkShare > 0.35) return unsure;
  const half = Math.ceil(Math.hypot(g.width, g.height) / 2) + 2;
  const bins = new Int32Array(half * 2 + 1);
  const score = (a: number) => rowScore(xs, ys, count, a, bins, half);

  let best = 0;
  let bestScore = -1;
  let total = 0;
  let tried = 0;
  for (let a = -maxAngle; a <= maxAngle + 1e-9; a += 0.5) {
    const s = score(a);
    total += s;
    tried++;
    if (s > bestScore) [best, bestScore] = [a, s];
  }
  const coarse = best;
  for (let a = coarse - 0.5; a <= coarse + 0.5 + 1e-9; a += 0.05) {
    if (Math.abs(a) > maxAngle) continue;
    const s = score(a);
    if (s > bestScore) [best, bestScore] = [a, s];
  }
  const zero = score(0);
  const gain = bestScore / Math.max(1, zero);
  const peak = bestScore / Math.max(1, total / tried);
  best = Math.round(best * 100) / 100;
  if (peak < minPeak) return { ...unsure, gain };
  if (Math.abs(best) < 0.05 || gain < minGain) return { angle: 0, verdict: Math.abs(best) < 0.3 ? 'straight' : 'unsure', gain };
  return { angle: best, verdict: 'tilted', gain };
}
