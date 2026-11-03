// Split book spreads: pure page-list logic. The worker measures each page (see worker/spread.ts);
// this decides what to split and builds the two halves. No DOM, no worker calls.
import type { Crop, PageRef, Rotation } from './types';
import { newUid } from './model';

/** A rectangle (0..1) on the page as it shows (after its added rotation) -> the same area before the rotation. */
export function shownToBase(r: Crop, rotation: Rotation): Crop {
  // Shown = base turned clockwise by `rotation`; undo that turn on each corner.
  const back = (x: number, y: number): [number, number] => {
    switch (rotation) {
      case 90:
        return [y, 1 - x];
      case 180:
        return [1 - x, 1 - y];
      case 270:
        return [1 - y, x];
      default:
        return [x, y];
    }
  };
  const a = back(r.x0, r.y0);
  const b = back(r.x1, r.y1);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}

/** The left and right halves (as the page shows), each reaching `overlap` past the spine. */
export function halfCrops(at: number, overlap: number, rotation: Rotation): [left: Crop, right: Crop] {
  const left = { x0: 0, y0: 0, x1: Math.min(1, at + overlap), y1: 1 };
  const right = { x0: Math.max(0, at - overlap), y0: 0, x1: 1, y1: 1 };
  return [shownToBase(left, rotation), shownToBase(right, rotation)];
}

export type SplitChoice = { overlap: number; rightFirst: boolean };

/**
 * Replaces one page with its two halves, in reading order (left first, or right first for
 * right-to-left books). Both point at the same source page; only the crop differs.
 */
export function splitPage(p: PageRef, at: number, choice: SplitChoice, review = false, makeUid: () => string = newUid): [PageRef, PageRef] {
  const base = unsplit(p);
  const id = p.spread?.id ?? makeUid();
  const rotation = p.spread?.rotation ?? p.addedRotation;
  const [l, r] = halfCrops(at, choice.overlap, rotation);
  const mk = (crop: Crop, side: 'left' | 'right', uid: string): PageRef => ({
    ...base,
    uid,
    crop,
    spread: { id, at, overlap: choice.overlap, side, rotation },
    ...(review ? { review: true } : {}),
  });
  const left = mk(l, 'left', choice.rightFirst ? makeUid() : p.uid);
  const right = mk(r, 'right', choice.rightFirst ? p.uid : makeUid());
  return choice.rightFirst ? [right, left] : [left, right];
}

/** The page as it was before it was split (keeps its fine rotation and photo corners). */
export function unsplit(p: PageRef): PageRef {
  const { crop: _c, spread, review: _r, ...rest } = p;
  return spread ? { ...rest, addedRotation: spread.rotation } : rest;
}

/** Puts the halves of spread `id` back together as one page, where the first half was. */
export function mergeSpread(pages: readonly PageRef[], id: string): PageRef[] {
  const first = pages.findIndex((p) => p.spread?.id === id);
  if (first < 0) return pages as PageRef[];
  const whole = { ...unsplit(pages[first]) };
  return pages.flatMap((p, i) => (i === first ? [whole] : p.spread?.id === id ? [] : [p]));
}

/** Splits spread `id` again at a new spine position (from the review editor). Clears its badge. */
export function resplit(pages: readonly PageRef[], id: string, at: number, choice: SplitChoice): PageRef[] {
  const first = pages.findIndex((p) => p.spread?.id === id);
  if (first < 0) return pages as PageRef[];
  const owner = pages[first];
  const halves = splitPage({ ...owner, spread: { ...owner.spread!, id } }, at, choice);
  return pages.flatMap((p, i) => (i === first ? halves : p.spread?.id === id ? [] : [p]));
}

/** Clears the "Check split" badge on spread `id` (Skip in review keeps it; Apply clears it). */
export function clearReview(pages: readonly PageRef[], id: string): PageRef[] {
  return pages.map((p) => {
    if (p.spread?.id !== id || !p.review) return p;
    const { review: _, ...rest } = p;
    return rest;
  });
}

// ---- Deciding ------------------------------------------------------------------------------------

/** What the worker found on one page, plus any fine rotation applied first to level a slanted spine. */
export type Measured = {
  uid: string;
  landscape: boolean;
  bothHalves: boolean;
  at: number;
  z: number;
  /** Spine still slanted (top and bottom differ by more than 1% of the width). */
  slanted: boolean;
  fineRotation?: number;
};

export type Decision = { at: number; review: boolean };
export type Plan = {
  split: Map<string, Decision>;
  /** Wide pages with something on both halves but no clear spine, left alone because no page in the batch had one either. */
  unclear: number;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Confident spreads split where their spine is. Wide pages without a clear spine use the median
 * spine of the confident pages (a book is bound the same way throughout) and get a review badge;
 * so do pages whose spine still slants. With no confident page to go by, unclear pages are left.
 */
export function planSplits(pages: readonly Measured[], minConfidence: number): Plan {
  const candidates = pages.filter((m) => m.landscape && m.bothHalves);
  const confident = candidates.filter((m) => m.z >= minConfidence && !m.slanted);
  const mid = confident.length ? median(confident.map((m) => m.at)) : null;
  const split = new Map<string, Decision>();
  let unclear = 0;
  for (const m of candidates) {
    if (m.z >= minConfidence && !m.slanted) split.set(m.uid, { at: m.at, review: false });
    else if (m.z >= minConfidence) split.set(m.uid, { at: m.at, review: true }); // clear spine, but slanted
    else if (mid !== null) split.set(m.uid, { at: mid, review: true });
    else unclear++;
  }
  return { split, unclear };
}

/** Applies a plan to the page list: one undoable edit for the whole batch. */
export function applyPlan(pages: readonly PageRef[], plan: Plan, fine: ReadonlyMap<string, number>, choice: SplitChoice, makeUid: () => string = newUid): PageRef[] {
  if (plan.split.size === 0 && fine.size === 0) return pages as PageRef[];
  return pages.flatMap((p) => {
    const d = plan.split.get(p.uid);
    if (!d) return [p];
    const f = fine.get(p.uid);
    const q = f !== undefined ? { ...p, fineRotation: f } : p;
    return splitPage(q, d.at, choice, d.review, makeUid);
  });
}
