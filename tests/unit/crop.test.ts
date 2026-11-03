// Crop: a rectangle chosen on a page, combined with any split crop, exported losslessly on PDF
// pages and as a real cut on photos.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import * as engine from '../../src/worker/engine';
import { planFor } from '../../src/lib/compression';
import { DEFAULTS, marginPtFor } from '../../src/lib/settings';
import * as model from '../../src/lib/model';
import { cleanTrim, editOf, editedSize, intersect, setTrims, within } from '../../src/lib/edits';
import { mergeSpread, resplit, splitPage } from '../../src/lib/split';
import type { ExportPage, OpenResult, PageRef } from '../../src/lib/types';

const fixture = (f: string) => {
  const b = readFileSync(new URL(`../fixtures/${f}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const ok = (r: OpenResult) => {
  if (r.status !== 'ok') throw new Error(r.status);
  return r;
};
const opts = { plan: planFor('lossless', DEFAULTS), imagePageSize: 'original' as const, marginPt: marginPtFor(DEFAULTS, 'none'), creditLine: '' };
let n = 0;
const uid = () => `c${++n}`;
const page = (sourceId = 's1', extra: Partial<PageRef> = {}): PageRef => ({ uid: uid(), sourceId, srcIndex: 0, addedRotation: 0, ...extra });
const textOf = (bytes: ArrayBuffer, i: number) => {
  const doc = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  const p = doc.loadPage(i);
  const st = p.toStructuredText('preserve-whitespace');
  const t = st.asText();
  st.destroy();
  p.destroy();
  doc.destroy();
  return t;
};

afterEach(() => engine.reset());

describe('crop maths', () => {
  it('places a crop inside a split half', () => {
    expect(within({ x0: 0.5, y0: 0, x1: 1, y1: 1 }, { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 })).toEqual({ x0: 0.55, y0: 0.2, x1: 0.95, y1: 0.8 });
  });
  it('finds the overlap of two rectangles', () => {
    expect(intersect({ x0: 0, y0: 0, x1: 0.51, y1: 1 }, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 })).toEqual({ x0: 0.1, y0: 0.1, x1: 0.51, y1: 0.9 });
    expect(intersect({ x0: 0, y0: 0, x1: 0.2, y1: 1 }, { x0: 0.5, y0: 0, x1: 1, y1: 1 })).toBeNull();
  });
  it('treats the whole page as no crop, and tidies the numbers', () => {
    expect(cleanTrim({ x0: 0, y0: 0, x1: 1, y1: 1 })).toBeNull();
    expect(cleanTrim({ x0: 0.9, y0: -0.1, x1: 0.123456, y1: 0.5 })).toEqual({ x0: 0.1235, y0: 0, x1: 0.9, y1: 0.5 });
  });
  it('hands the worker one combined crop, and sizes the page from it', () => {
    const p = page('s1', { crop: { x0: 0, y0: 0, x1: 0.5, y1: 1 }, trim: { x0: 0.2, y0: 0.1, x1: 1, y1: 0.9 } });
    expect(editOf(p)?.crop).toEqual({ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.9 });
    const [w, h] = editedSize([1000, 800], editOf(p), 3000);
    expect(w).toBeCloseTo(400, 6);
    expect(h).toBeCloseTo(640, 6);
    expect(editOf(page())).toBeUndefined();
  });
});

describe('page model', () => {
  it('crops every chosen page in one undoable edit, and Remove takes it off', () => {
    let pages = [page(), page(), page()];
    const chosen = new Set([pages[0].uid, pages[2].uid]);
    let h: model.History = { undo: [], redo: [] };
    const before = pages;
    const next = setTrims(pages, chosen, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    h = model.pushHistory(h, pages);
    pages = next;
    expect(pages.map((p) => !!p.trim)).toEqual([true, false, true]);
    expect(setTrims(pages, chosen, { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 })).toBe(pages); // no change, no undo step
    expect(model.undo(h, pages)!.pages).toBe(before);
    expect(setTrims(pages, chosen, null).every((p) => !('trim' in p))).toBe(true);
  });
  it('a page cropped before it is split gives each half its share of the crop', () => {
    const p = page('s1', { trim: { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.95 } });
    const [l, r] = splitPage(p, 0.5, { overlap: 0, rightFirst: false }, false, uid);
    expect(l.crop).toEqual({ x0: 0.1, y0: 0.05, x1: 0.5, y1: 0.95 });
    expect(r.crop).toEqual({ x0: 0.5, y0: 0.05, x1: 0.9, y1: 0.95 });
    expect('trim' in l || 'trim' in r).toBe(false);
  });
  it('a crop made on a half is dropped when the split is adjusted or taken back', () => {
    const [l, r] = splitPage(page(), 0.5, { overlap: 0, rightFirst: false }, false, uid);
    const pages = [{ ...l, trim: { x0: 0.1, y0: 0, x1: 1, y1: 1 } }, r];
    const id = l.spread!.id;
    expect(resplit(pages, id, 0.45, { overlap: 0, rightFirst: false }).some((p) => p.trim)).toBe(false);
    expect(mergeSpread(pages, id)[0].trim).toBeUndefined();
  });
});

describe('export', () => {
  it('a cropped PDF page keeps only the text inside the crop, as real text', async () => {
    const { sourceId, pageSizes } = ok(engine.open(fixture('spread-text.pdf')));
    // Keep the left page's title area only: left half, top quarter.
    const p = page(sourceId, { trim: { x0: 0, y0: 0, x1: 0.5, y1: 0.25 } });
    const r = await engine.exportPdf([{ sourceId, srcIndex: 0, addedRotation: 0, edit: editOf(p) } as ExportPage], opts, () => {});
    const t = textOf(r.bytes, 0);
    expect(t).toContain('LEFT PAGE');
    expect(t).not.toContain('RIGHT PAGE');
    expect(t).not.toContain('line 14');
    const back = ok(engine.open(r.bytes));
    expect(back.pageSizes[0][0]).toBeCloseTo(pageSizes[0][0] / 2, 0);
    expect(back.pageSizes[0][1]).toBeCloseTo(pageSizes[0][1] / 4, 0);
  });
  it('a crop on a straightened page applies after the turn', async () => {
    const { sourceId } = ok(engine.open(fixture('tilted-scans.pdf')));
    const p = page(sourceId, { srcIndex: 1, fineRotation: -5, trim: { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.6 } });
    const r = await engine.exportPdf([{ sourceId, srcIndex: 1, addedRotation: 0, edit: editOf(p) } as ExportPage], opts, () => {});
    const back = ok(engine.open(r.bytes));
    expect(engine.detectSkew(back.sourceId, 0).verdict).toBe('straight');
  });
  it('a cropped photo is cut to the crop', () => {
    const img = engine.addImage(fixture('photo-of-sheet.jpg'));
    const p = page(img.sourceId, { trim: { x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.6 } });
    const out = engine.renderImage({ sourceId: img.sourceId, srcIndex: 0, addedRotation: 0, edit: editOf(p) }, { dpi: 150, format: 'jpg', jpegQuality: 90, maxPixels: 25e6 });
    const pic = new mupdf.Image(new Uint8Array(out.bytes));
    expect(pic.getWidth()).toBeCloseTo(800, -1);
    expect(pic.getHeight()).toBeCloseTo(600, -1);
    pic.destroy();
  });
});
