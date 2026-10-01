import { describe, expect, it } from 'vitest';
import {
  MAX_UNDO,
  deletePages,
  movePage,
  moveSelection,
  normaliseRotation,
  pruneSelection,
  pushHistory,
  rangeBetween,
  redo,
  rotatePages,
  undo,
  type History,
} from '../../src/lib/model';
import type { PageRef } from '../../src/lib/types';

const pages = (ids: string): PageRef[] => [...ids].map((c, i) => ({ uid: c, sourceId: 's1', srcIndex: i, addedRotation: 0 }));
const ids = (p: PageRef[]) => p.map((x) => x.uid).join('');

describe('normaliseRotation', () => {
  it.each([
    [0, 0], [90, 90], [180, 180], [270, 270], [360, 0], [450, 90], [-90, 270], [-180, 180], [-450, 270], [720, 0],
  ])('%i -> %i', (input, out) => expect(normaliseRotation(input)).toBe(out));
});

describe('rotatePages', () => {
  it('rotates only the selected pages, adding to the existing rotation', () => {
    const p = rotatePages(rotatePages(pages('abc'), new Set(['b']), 90), new Set(['b', 'c']), 270);
    expect(p.map((x) => x.addedRotation)).toEqual([0, 0, 270]);
  });
  it('rotates every page when nothing is selected', () => {
    expect(rotatePages(pages('abc'), new Set(), -90).map((x) => x.addedRotation)).toEqual([270, 270, 270]);
  });
  it('does not mutate its input', () => {
    const p = pages('ab');
    rotatePages(p, new Set(['a']), 90);
    expect(p[0].addedRotation).toBe(0);
  });
});

describe('deletePages', () => {
  it('removes the selection', () => expect(ids(deletePages(pages('abcd'), new Set(['b', 'd'])))).toBe('ac'));
  it('removes everything when nothing is selected', () => expect(deletePages(pages('abc'), new Set())).toEqual([]));
});

describe('movePage', () => {
  it('moves forward and backward', () => {
    expect(ids(movePage(pages('abcde'), 0, 3))).toBe('bcdae');
    expect(ids(movePage(pages('abcde'), 4, 1))).toBe('aebcd');
  });
  it('clamps the target and ignores bad sources', () => {
    expect(ids(movePage(pages('abc'), 0, 99))).toBe('bca');
    expect(ids(movePage(pages('abc'), 7, 0))).toBe('abc');
  });
});

describe('moveSelection (Alt+Arrow)', () => {
  it('moves a single page left and right', () => {
    expect(ids(moveSelection(pages('abcd'), new Set(['c']), -1))).toBe('acbd');
    expect(ids(moveSelection(pages('abcd'), new Set(['b']), 1))).toBe('acbd');
  });
  it('moves a contiguous block together', () => {
    expect(ids(moveSelection(pages('abcde'), new Set(['c', 'd']), -1))).toBe('acdbe');
    expect(ids(moveSelection(pages('abcde'), new Set(['b', 'c']), 1))).toBe('adbce');
  });
  it('moves scattered pages independently, keeping order', () => {
    expect(ids(moveSelection(pages('abcde'), new Set(['b', 'd']), -1))).toBe('badce');
  });
  it('leaves pages at the edge (and those queued behind them) in place', () => {
    expect(ids(moveSelection(pages('abcd'), new Set(['a', 'b']), -1))).toBe('abcd');
    expect(ids(moveSelection(pages('abcd'), new Set(['a', 'c']), -1))).toBe('acbd');
    expect(ids(moveSelection(pages('abcd'), new Set(['d']), 1))).toBe('abcd');
  });
});

describe('selection helpers', () => {
  it('rangeBetween works in either direction', () => {
    expect(rangeBetween(pages('abcde'), 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(pages('abcde'), 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(pages('abc'), 'zz', 'c')).toEqual(['c']);
  });
  it('pruneSelection drops uids that are gone', () => {
    expect([...pruneSelection(pages('ac'), new Set(['a', 'b']))]).toEqual(['a']);
  });
});

describe('undo / redo', () => {
  it('walks back and forward through snapshots', () => {
    let h: History = { undo: [], redo: [] };
    let cur = pages('abc');
    h = pushHistory(h, cur);
    cur = deletePages(cur, new Set(['b']));
    h = pushHistory(h, cur);
    cur = movePage(cur, 0, 1);
    expect(ids(cur)).toBe('ca');

    let r = undo(h, cur)!;
    expect(ids(r.pages)).toBe('ac');
    r = undo(r.history, r.pages)!;
    expect(ids(r.pages)).toBe('abc');
    expect(undo(r.history, r.pages)).toBeNull();

    r = redo(r.history, r.pages)!;
    expect(ids(r.pages)).toBe('ac');
    r = redo(r.history, r.pages)!;
    expect(ids(r.pages)).toBe('ca');
    expect(redo(r.history, r.pages)).toBeNull();
  });
  it('a new edit clears redo', () => {
    let h = pushHistory({ undo: [], redo: [] }, pages('ab'));
    const r = undo(h, pages('a'))!;
    h = pushHistory(r.history, r.pages);
    expect(h.redo).toEqual([]);
  });
  it('caps the undo depth', () => {
    let h: History = { undo: [], redo: [] };
    for (let i = 0; i < MAX_UNDO + 20; i++) h = pushHistory(h, pages('a'));
    expect(h.undo.length).toBe(MAX_UNDO);
  });
});
