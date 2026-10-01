// Page-list logic. Pure functions over PageRef[]: no DOM, no worker calls, easy to unit-test.
import type { PageRef, Rotation } from './types';

export const MAX_UNDO = 100;

export function normaliseRotation(deg: number): Rotation {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;
}

/** Rotates the pages whose uid is in `uids` (or every page when `uids` is empty) by `delta` degrees. */
export function rotatePages(pages: readonly PageRef[], uids: ReadonlySet<string>, delta: number): PageRef[] {
  const all = uids.size === 0;
  return pages.map((p) => (all || uids.has(p.uid) ? { ...p, addedRotation: normaliseRotation(p.addedRotation + delta) } : p));
}

/** Removes the pages in `uids` (or every page when `uids` is empty). */
export function deletePages(pages: readonly PageRef[], uids: ReadonlySet<string>): PageRef[] {
  return uids.size === 0 ? [] : pages.filter((p) => !uids.has(p.uid));
}

/** Moves the page at `from` so that it ends up at index `to`. */
export function movePage(pages: readonly PageRef[], from: number, to: number): PageRef[] {
  if (from === to || from < 0 || from >= pages.length) return [...pages];
  const out = [...pages];
  const [p] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, p);
  return out;
}

/**
 * Moves every selected page one step left (delta -1) or right (+1), keeping their relative order.
 * A selected page already at the edge stays put, and so does any selected page directly behind it.
 */
export function moveSelection(pages: readonly PageRef[], selected: ReadonlySet<string>, delta: -1 | 1): PageRef[] {
  const out = [...pages];
  const n = out.length;
  const order = delta < 0 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
  const blocked = new Set<number>(); // target positions that hold a selected page that could not move
  for (const i of order) {
    if (!selected.has(out[i].uid)) continue;
    const j = i + delta;
    if (j < 0 || j >= n || blocked.has(j)) {
      blocked.add(i);
      continue;
    }
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Inclusive range of uids between two pages, in page order (for Shift+click). */
export function rangeBetween(pages: readonly PageRef[], aUid: string, bUid: string): string[] {
  const a = pages.findIndex((p) => p.uid === aUid);
  const b = pages.findIndex((p) => p.uid === bUid);
  if (a < 0 || b < 0) return b >= 0 ? [bUid] : [];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return pages.slice(lo, hi + 1).map((p) => p.uid);
}

/** Drops selected uids that no longer exist in `pages`. */
export function pruneSelection(pages: readonly PageRef[], selection: ReadonlySet<string>): Set<string> {
  const live = new Set(pages.map((p) => p.uid));
  return new Set([...selection].filter((u) => live.has(u)));
}

export type History = { undo: PageRef[][]; redo: PageRef[][] };

/** Records `current` before an edit replaces it. Clears redo, caps the undo depth. */
export function pushHistory(h: History, current: PageRef[]): History {
  const undo = [...h.undo, current];
  if (undo.length > MAX_UNDO) undo.shift();
  return { undo, redo: [] };
}

export function undo(h: History, current: PageRef[]): { history: History; pages: PageRef[] } | null {
  if (h.undo.length === 0) return null;
  const pages = h.undo[h.undo.length - 1];
  return { pages, history: { undo: h.undo.slice(0, -1), redo: [...h.redo, current] } };
}

export function redo(h: History, current: PageRef[]): { history: History; pages: PageRef[] } | null {
  if (h.redo.length === 0) return null;
  const pages = h.redo[h.redo.length - 1];
  return { pages, history: { undo: [...h.undo, current], redo: h.redo.slice(0, -1) } };
}

let uidCounter = 0;
export function newUid(prefix = 'p'): string {
  uidCounter += 1;
  return `${prefix}${uidCounter.toString(36)}`;
}
