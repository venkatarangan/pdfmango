// Straighten photo's suggested corners, Crop's Auto, and turning a cut page about its own middle.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import * as engine from '../../src/worker/engine';
import { planFor } from '../../src/lib/compression';
import { DEFAULTS, marginPtFor } from '../../src/lib/settings';
import { editOf, withFineRotation } from '../../src/lib/edits';
import type { Crop, OpenResult, PageEdit, PageRef } from '../../src/lib/types';

const fixture = (f: string) => {
  const b = readFileSync(new URL(`../fixtures/${f}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const ok = (r: OpenResult) => {
  if (r.status !== 'ok') throw new Error(r.status);
  return r;
};
const words = (t: string) => t.replace(/\s+/g, ' ').trim();
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

describe('Straighten photo: suggested corners', () => {
  it('finds the corners of a sheet on a table within 1.5% of where they are', () => {
    const SHEET = [[372, 148], [1262, 236], [1338, 1092], [246, 1010]].map(([x, y]) => [x / 1600, y / 1200]);
    const r = engine.findSheetCorners(engine.addImage(fixture('photo-of-sheet.jpg')).sourceId);
    expect(r).not.toBeNull();
    r!.corners.forEach(([x, y], i) => {
      expect(Math.abs(x - SHEET[i][0])).toBeLessThan(0.015);
      expect(Math.abs(y - SHEET[i][1])).toBeLessThan(0.015);
    });
  });
  it('takes both pages of an open book, even across a dark fold', () => {
    for (const f of ['spread-photo-fold.jpg', 'spread-photo-slanted.jpg']) {
      const r = engine.findSheetCorners(engine.addImage(fixture(f)).sourceId);
      expect(r, f).not.toBeNull();
      const xs = r!.corners.map((c) => c[0]);
      expect(Math.max(...xs) - Math.min(...xs), f).toBeGreaterThan(0.8);
    }
  });
  it('suggests nothing when the page fills the photo, or for PDF pages', () => {
    expect(engine.findSheetCorners(engine.addImage(fixture('spread.jpg')).sourceId)).toBeNull();
    expect(engine.findSheetCorners(ok(engine.open(fixture('text-50.pdf'))).sourceId)).toBeNull();
  });
});

describe('Crop: Auto', () => {
  it('trims the empty margins of a clean page and keeps all its text', async () => {
    const { sourceId } = ok(engine.open(fixture('text-50.pdf')));
    const crop = engine.autoCrop(sourceId, 0, 0)!;
    expect(crop).not.toBeNull();
    expect(crop.x0).toBeGreaterThan(0.03);
    expect(crop.y1).toBeLessThan(0.8); // the empty bottom of the page goes
    const r = await engine.exportPdf(
      [{ sourceId, srcIndex: 0, addedRotation: 0, edit: { crop } }],
      { plan: planFor('lossless', DEFAULTS), imagePageSize: 'A4', marginPt: marginPtFor(DEFAULTS, 'none'), creditLine: '' },
      () => {},
    );
    expect(words(textOf(r.bytes, 0))).toBe(words(textOf(fixture('text-50.pdf'), 0)));
  });
  it('cuts a page photographed on a chair to the paper', () => {
    const c = engine.autoCrop(engine.addImage(fixture('spread-photo-fold.jpg')).sourceId, 0, 0)!;
    // The paper covers 0.065–0.935 across and 0.065–0.935 down.
    for (const [got, want] of [[c.x0, 0.065], [c.y0, 0.065], [c.x1, 0.935], [c.y1, 0.935]]) expect(Math.abs(got - want)).toBeLessThan(0.02);
  });
  it('looks at the page as it shows, after an added rotation', () => {
    const { sourceId } = ok(engine.open(fixture('text-50.pdf')));
    const up = engine.autoCrop(sourceId, 0, 0)!;
    const turned = engine.autoCrop(sourceId, 0, 90)!;
    // Turned a quarter clockwise, the empty bottom of the page is now on the left.
    expect(turned.x0).toBeCloseTo(1 - up.y1, 1);
  });
});

describe('a cut page turns about its own middle', () => {
  /** Centre of the ink in a saved page image, 0..1. */
  const inkCentre = (bytes: ArrayBuffer) => {
    const img = new mupdf.Image(new Uint8Array(bytes));
    const pix = img.toPixmap().convertToColorSpace(mupdf.ColorSpace.DeviceGray);
    const [w, h, px] = [pix.getWidth(), pix.getHeight(), pix.getPixels()];
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (px[y * w + x] < 128) {
          sx += x;
          sy += y;
          n++;
        }
    img.destroy();
    pix.destroy();
    return [sx / n / w, sy / n / h];
  };
  it('Straighten on a split half sets the turning point to the middle of the half', () => {
    const half: PageRef = { uid: 'h', sourceId: 's', srcIndex: 0, addedRotation: 0, crop: { x0: 0, y0: 0, x1: 0.51, y1: 1 } };
    expect(withFineRotation(half, 3).pivot).toEqual([0.255, 0.5]);
    expect(withFineRotation({ ...half, crop: undefined }, 3).pivot).toBeUndefined();
    expect('pivot' in withFineRotation(withFineRotation(half, 3), 0)).toBe(false);
  });
  it('so the half’s content stays put instead of sliding up or down', () => {
    const { sourceId } = ok(engine.open(fixture('spread-text.pdf')));
    const crop: Crop = { x0: 0, y0: 0, x1: 0.51, y1: 1 };
    const opts = { dpi: 72, format: 'png' as const, jpegQuality: 90, maxPixels: 25e6 };
    const shot = (edit: PageEdit) => inkCentre(engine.renderImage({ sourceId, srcIndex: 0, addedRotation: 0, edit }, opts).bytes);
    const flat = shot({ crop });
    const own = shot(editOf({ ...withFineRotation({ uid: 'h', sourceId, srcIndex: 0, addedRotation: 0, crop }, 4) })!);
    const spread = shot({ crop, fineRotation: 4 }); // the old way: about the middle of the whole spread
    const moved = (c: number[]) => Math.hypot(c[0] - flat[0], c[1] - flat[1]);
    expect(moved(own)).toBeLessThan(moved(spread) * 0.75); // measured: about half as far
  });
});
