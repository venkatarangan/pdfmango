// Straighten photo: four corners flatten a photo of a sheet into an upright, cropped page.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import * as engine from '../../src/worker/engine';
import { planFor } from '../../src/lib/compression';
import { DEFAULTS, marginPtFor } from '../../src/lib/settings';
import * as model from '../../src/lib/model';
import { DEFAULT_CORNERS, isUsableQuad, setCorners, warpSize } from '../../src/lib/edits';
import type { ExportPage, PageRef, Quad } from '../../src/lib/types';

const fixture = (f: string) => {
  const b = readFileSync(new URL(`../fixtures/${f}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
// The sheet's corners in photo-of-sheet.jpg (1600 x 1200), from scripts/make-fixtures-pages.mjs.
const SHEET = [[372, 148], [1262, 236], [1338, 1092], [246, 1010]];
const corners = SHEET.map(([x, y]) => [x / 1600, y / 1200]) as Quad;
const opts = { plan: planFor('lossless', DEFAULTS), imagePageSize: 'original' as const, marginPt: marginPtFor(DEFAULTS, 'none'), creditLine: '' };

afterEach(() => engine.reset());

/** Mean brightness of a strip along each edge of an image, and of the whole image. */
function edges(bytes: ArrayBuffer) {
  const img = new mupdf.Image(new Uint8Array(bytes));
  const pix = img.toPixmap().convertToColorSpace(mupdf.ColorSpace.DeviceGray);
  const [w, h, px] = [pix.getWidth(), pix.getHeight(), pix.getPixels()];
  const mean = (x0: number, y0: number, x1: number, y1: number) => {
    let s = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) (s += px[y * w + x]), n++;
    return s / n;
  };
  const m = 6;
  const r = { w, h, top: mean(m, m, w - m, 2 * m), bottom: mean(m, h - 2 * m, w - m, h - m), left: mean(m, m, 2 * m, h - m), right: mean(w - 2 * m, m, w - m, h - m) };
  img.destroy();
  pix.destroy();
  return r;
}

describe('Straighten photo', () => {
  it('flattens the sheet: the table is gone and the text lines are level', async () => {
    const src = engine.addImage(fixture('photo-of-sheet.jpg'));
    const edges0 = edges(engine.renderImage({ sourceId: src.sourceId, srcIndex: 0, addedRotation: 0 }, { dpi: 150, format: 'jpg', jpegQuality: 90, maxPixels: 25e6 }).bytes);
    expect(edges0.left).toBeLessThan(120); // the dark table shows round the original photo

    const page: ExportPage = { sourceId: src.sourceId, srcIndex: 0, addedRotation: 0, edit: { corners } };
    const out = engine.renderImage(page, { dpi: 150, format: 'jpg', jpegQuality: 90, maxPixels: 25e6 });
    const e = edges(out.bytes);
    expect([e.w, e.h]).toEqual(warpSize(corners, 1600, 1200, 3000));
    for (const side of [e.top, e.bottom, e.left, e.right]) expect(side).toBeGreaterThan(190); // paper on every edge
    expect(engine.detectSkew(src.sourceId, 0, { corners }).verdict).toBe('straight');
  });

  it('exports a new JPEG page of the flattened size; the untouched photo is unchanged', async () => {
    const src = engine.addImage(fixture('photo-of-sheet.jpg'));
    const pages: ExportPage[] = [
      { sourceId: src.sourceId, srcIndex: 0, addedRotation: 0, edit: { corners } },
      { sourceId: src.sourceId, srcIndex: 0, addedRotation: 0 },
    ];
    const r = await engine.exportPdf(pages, opts, () => {});
    const back = engine.open(r.bytes);
    if (back.status !== 'ok') throw new Error(back.status);
    const [w, h] = warpSize(corners, 1600, 1200, 3000);
    // 'original' size places each photo at its own resolution, which the flattened copy keeps.
    const ptPerPx = back.pageSizes[1][0] / 1600;
    expect(back.pageSizes[1][1]).toBeCloseTo(1200 * ptPerPx, 1);
    expect(back.pageSizes[0][0]).toBeCloseTo(w * ptPerPx, 1);
    expect(back.pageSizes[0][1]).toBeCloseTo(h * ptPerPx, 1);
  });

  it('caps the long side at 3000 px', () => {
    expect(Math.max(...warpSize([[0, 0], [1, 0], [1, 1], [0, 1]], 8000, 6000, 3000))).toBe(3000);
  });

  it('accepts a sensible outline and refuses crossed or tiny ones', () => {
    expect(isUsableQuad(corners, 1600, 1200)).toBe(true);
    expect(isUsableQuad(DEFAULT_CORNERS, 1600, 1200)).toBe(true);
    expect(isUsableQuad([[0.1, 0.1], [0.9, 0.9], [0.9, 0.1], [0.1, 0.9]], 1600, 1200)).toBe(false); // crossed
    expect(isUsableQuad([[0.5, 0.5], [0.501, 0.5], [0.501, 0.501], [0.5, 0.501]], 1600, 1200)).toBe(false); // tiny
  });

  it('undo and redo walk through corners', () => {
    let pages: PageRef[] = [{ uid: 'a', sourceId: 's1', srcIndex: 0, addedRotation: 0 }];
    let h: model.History = { undo: [], redo: [] };
    const next = setCorners(pages, 'a', corners);
    h = model.pushHistory(h, pages);
    pages = next;
    expect(pages[0].corners).toEqual(corners);
    expect(setCorners(pages, 'a', corners)).toBe(pages); // no change, no undo step
    const u = model.undo(h, pages)!;
    expect(u.pages[0].corners).toBeUndefined();
    expect(model.redo(u.history, u.pages)!.pages[0].corners).toEqual(corners);
    expect(Object.keys(setCorners(pages, 'a', undefined)[0])).not.toContain('corners');
  });
});
