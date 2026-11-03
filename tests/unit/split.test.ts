// Split book spreads: spine detection on the test scans, the decisions for a whole book, the crop
// maths (including /Rotate 90), export with text on each half, and undo.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import * as engine from '../../src/worker/engine';
import { planFor } from '../../src/lib/compression';
import { DEFAULTS, marginPtFor } from '../../src/lib/settings';
import * as model from '../../src/lib/model';
import { config } from '../../src/pdfmango.config';
import { applyPlan, halfCrops, mergeSpread, planSplits, resplit, shownToBase, splitPage, type Measured } from '../../src/lib/split';
import { editOf } from '../../src/lib/edits';
import { scanDocument } from '../../src/worker/pdf-tools';
import type { ExportPage, OpenResult, PageRef, Rotation } from '../../src/lib/types';

const fixture = (f: string) => {
  const b = readFileSync(new URL(`../fixtures/${f}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const truth = JSON.parse(readFileSync(new URL('../fixtures/spreads.json', import.meta.url), 'utf8')) as Record<string, (number | null)[]>;
const ok = (r: OpenResult) => {
  if (r.status !== 'ok') throw new Error(r.status);
  return r;
};
const opts = (level: 'lossless' | 'scan' = 'lossless') => ({ plan: planFor(level, DEFAULTS), imagePageSize: 'A4' as const, marginPt: marginPtFor(DEFAULTS, 'none'), creditLine: '' });
const choice = { overlap: 0.01, rightFirst: false };
let uidN = 0;
const uid = () => `t${++uidN}`;
const refs = (sourceId: string, n: number, rotation: Rotation = 0): PageRef[] => Array.from({ length: n }, (_, i) => ({ uid: uid(), sourceId, srcIndex: i, addedRotation: rotation }));

/** What the app's batch does for each page: measure, straighten a slanted spine, measure again. */
function measure(p: PageRef): { m: Measured; fine?: number } {
  let edit = editOf(p);
  let a = engine.analyseSpread(p.sourceId, p.srcIndex, p.addedRotation, edit);
  let fine: number | undefined;
  if (a.landscape && a.bothHalves && Math.abs(a.slant) > 0.01 && !p.fineRotation) {
    const s = engine.detectSkew(p.sourceId, p.srcIndex, edit);
    if (s.verdict === 'tilted') {
      fine = -s.angle;
      edit = { ...edit, fineRotation: fine };
      a = engine.analyseSpread(p.sourceId, p.srcIndex, p.addedRotation, edit);
    }
  }
  return { m: { uid: p.uid, landscape: a.landscape, bothHalves: a.bothHalves, at: a.gutter.at, z: a.gutter.z, slanted: Math.abs(a.slant) > 0.01 }, fine };
}

function textOf(bytes: ArrayBuffer, i: number) {
  const doc = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  const p = doc.loadPage(i);
  const st = p.toStructuredText('preserve-whitespace');
  const t = st.asText();
  st.destroy();
  p.destroy();
  doc.destroy();
  return t;
}

afterEach(() => engine.reset());

describe('spine detector', () => {
  it('finds the spine within 2% of the width on the spread scans', () => {
    for (const f of ['spread-scan.pdf', 'spread-white-gap.pdf', 'spread-rotate90.pdf', 'spread-text.pdf']) {
      const { sourceId, pageCount } = ok(engine.open(fixture(f)));
      for (let i = 0; i < pageCount; i++) {
        const a = engine.analyseSpread(sourceId, i, 0);
        expect(a.landscape, f).toBe(true);
        expect(Math.abs(a.gutter.at - truth[f][i]!), f).toBeLessThan(0.02);
        expect(a.gutter.z, f).toBeGreaterThanOrEqual(config.split.minConfidence);
      }
    }
    const jpg = engine.addImage(fixture('spread.jpg'));
    expect(Math.abs(engine.analyseSpread(jpg.sourceId, 0, 0).gutter.at - truth['spread.jpg'][0]!)).toBeLessThan(0.02);
  });
  it('tells a dark spine from a white gap', () => {
    expect(engine.analyseSpread(ok(engine.open(fixture('spread-scan.pdf'))).sourceId, 0, 0).gutter.kind).toBe('shadow');
    expect(engine.analyseSpread(ok(engine.open(fixture('spread-white-gap.pdf'))).sourceId, 0, 0).gutter.kind).toBe('gap');
  });
  it('levels a slanted phone photo of a spread before splitting it', () => {
    const img = engine.addImage(fixture('spread-photo-slanted.jpg'));
    const [p] = refs(img.sourceId, 1);
    const first = engine.analyseSpread(p.sourceId, 0, 0);
    expect(Math.abs(first.slant)).toBeGreaterThan(0.01);
    const { m, fine } = measure(p);
    expect(fine).toBeCloseTo(-2.5, 0);
    expect(m.slanted).toBe(false);
    expect(Math.abs(m.at - truth['spread-photo-slanted.jpg'][0]!)).toBeLessThan(0.02);
  });
  it('finds a fold that is only a faint step in brightness, as in a phone photo of a booklet', () => {
    const img = engine.addImage(fixture('spread-photo-fold.jpg'));
    const a = engine.analyseSpread(img.sourceId, 0, 0);
    expect(a.gutter.kind).toBe('crease');
    expect(Math.abs(a.gutter.at - truth['spread-photo-fold.jpg'][0]!)).toBeLessThan(0.02);
    expect(a.gutter.z).toBeGreaterThanOrEqual(config.split.minGuess);
  });
  it('does not mistake an edge inside a photo for a fold', () => {
    const { sourceId, pageCount } = ok(engine.open(fixture('photo-heavy.pdf')));
    for (let i = 0; i < pageCount; i++) expect(engine.analyseSpread(sourceId, i, 0).gutter.z).toBeLessThan(config.split.minGuess);
  });
  it('looks at the page as it shows: a page rotated in PDFMango is measured upright', () => {
    const { sourceId } = ok(engine.open(fixture('spread-scan.pdf')));
    expect(engine.analyseSpread(sourceId, 0, 90).landscape).toBe(false); // now taller than wide
  });
});

describe('a whole book', () => {
  it('splits every spread, leaves the covers and single pages, and flags the unclear one', () => {
    const { sourceId, pageCount } = ok(engine.open(fixture('book-20.pdf')));
    const pages = refs(sourceId, pageCount);
    const measured = pages.map((p) => measure(p).m);
    const plan = planSplits(measured, config.split.minConfidence);
    const want = truth['book-20.pdf'];
    pages.forEach((p, i) => {
      const d = plan.split.get(p.uid);
      if (want[i] === null) expect(d, `page ${i + 1} is a single page`).toBeUndefined();
      else {
        expect(d, `page ${i + 1} is a spread`).toBeDefined();
        expect(Math.abs(d!.at - want[i]!), `page ${i + 1}`).toBeLessThan(0.02);
      }
    });
    const flagged = pages.map((p, i) => (plan.split.get(p.uid)?.review ? i + 1 : 0)).filter(Boolean);
    expect(flagged).toEqual([18]); // the spread whose spine barely shows
    const out = applyPlan(pages, plan, new Map(), choice, uid);
    expect(out.length).toBe(3 + 17 * 2);
  });
  it('leaves wide pages alone when no page in the batch has a clear spine', () => {
    const { sourceId, pageCount } = ok(engine.open(fixture('photo-heavy.pdf')));
    const plan = planSplits(refs(sourceId, pageCount).map((p) => measure(p).m), config.split.minConfidence, config.split.minGuess);
    expect(plan.split.size).toBe(0);
    expect(plan.unclear + plan.oneSided).toBe(pageCount);
  });
  it('on its own, a wide page with a fair guess is split at it and flagged', () => {
    const plan = planSplits(
      [
        { uid: 'a', landscape: true, bothHalves: true, at: 0.49, z: 3.5, slanted: false },
        { uid: 'b', landscape: true, bothHalves: true, at: 0.5, z: 1, slanted: false },
        { uid: 'c', landscape: false, bothHalves: true, at: 0.5, z: 0, slanted: false },
        { uid: 'd', landscape: true, bothHalves: false, at: 0.5, z: 9, slanted: false },
      ],
      config.split.minConfidence,
      config.split.minGuess,
    );
    expect(plan.split.get('a')).toEqual({ at: 0.49, review: true });
    expect([...plan.split.keys()]).toEqual(['a']);
    expect({ unclear: plan.unclear, portrait: plan.portrait, oneSided: plan.oneSided }).toEqual({ unclear: 1, portrait: 1, oneSided: 1 });
  });
  it('finds the spine of a 300-page book in well under a minute', () => {
    const { sourceId } = ok(engine.open(fixture('book-20.pdf')));
    const t = performance.now();
    for (let i = 0; i < 30; i++) engine.analyseSpread(sourceId, 1 + (i % 17), 0);
    expect(((performance.now() - t) / 30) * 300).toBeLessThan(60_000);
  });
});

describe('crop maths', () => {
  it('maps a shown rectangle back through each added rotation', () => {
    const left = { x0: 0, y0: 0, x1: 0.5, y1: 1 };
    expect(shownToBase(left, 0)).toEqual(left);
    expect(shownToBase(left, 90)).toEqual({ x0: 0, y0: 0.5, x1: 1, y1: 1 }); // shown left = bottom of the unturned page
    expect(shownToBase(left, 180)).toEqual({ x0: 0.5, y0: 0, x1: 1, y1: 1 });
    expect(shownToBase(left, 270)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0.5 });
  });
  it('gives each half the overlap past the spine', () => {
    const [l, r] = halfCrops(0.48, 0.01, 0);
    expect(l.x1).toBeCloseTo(0.49, 9);
    expect(r.x0).toBeCloseTo(0.47, 9);
  });
});

describe('export', () => {
  for (const [name, index] of [['a plain spread', 0], ['a spread with /Rotate 90', 1]] as const) {
    it(`each half of ${name} keeps its own text, in reading order`, async () => {
      const { sourceId } = ok(engine.open(fixture('spread-text.pdf')));
      const [p] = refs(sourceId, 2).slice(index, index + 1);
      for (const rightFirst of [false, true]) {
        const halves = splitPage(p, 0.5, { overlap: 0.01, rightFirst }, false, uid);
        const pages: ExportPage[] = halves.map((h) => ({ sourceId, srcIndex: h.srcIndex, addedRotation: h.addedRotation, edit: editOf(h) }));
        const r = await engine.exportPdf(pages, opts(), () => {});
        const back = ok(engine.open(r.bytes));
        expect(back.pageCount).toBe(2);
        const [first, second] = rightFirst ? ['RIGHT', 'LEFT'] : ['LEFT', 'RIGHT'];
        for (const [i, want, not] of [[0, first, second], [1, second, first]] as const) {
          const t = textOf(r.bytes, i);
          expect(t).toContain(`${want} PAGE`);
          expect(t).not.toContain(`${not} PAGE`);
        }
        // Each half is a portrait page about half as wide as the spread.
        for (const [w, h] of back.pageSizes) {
          expect(h).toBeGreaterThan(w);
          expect(w).toBeCloseTo(1190 * 0.51, 0);
        }
      }
    });
  }
  it('Lossless keeps the hidden half in the file; the Scan step redraws only the visible half', async () => {
    const { sourceId } = ok(engine.open(fixture('spread-scan.pdf')));
    const halves = splitPage(refs(sourceId, 1)[0], 0.5, choice, false, uid);
    const pages: ExportPage[] = halves.map((h) => ({ sourceId, srcIndex: 0, addedRotation: 0, edit: editOf(h) }));
    const lossless = await engine.exportPdf(pages, opts(), () => {});
    const doc = mupdf.Document.openDocument(new Uint8Array(lossless.bytes), 'application/pdf').asPDF()!;
    const imageWidths = (d: mupdf.PDFDocument) =>
      [0, 1].map((i) => {
        let w = 0;
        d.findPage(i).get('Resources').get('XObject').forEach((x) => (w = x.get('Width').asNumber()));
        return w;
      });
    const full = imageWidths(doc);
    expect(full[0]).toBe(full[1]); // both halves still hold the whole scan
    const scanned = await scanDocument(doc, { ppi: 110, quality: 60 }, () => {}, async () => {});
    const [w] = imageWidths(scanned);
    const pageW = ok(engine.open(lossless.bytes)).pageSizes[0][0];
    expect(w).toBeCloseTo((pageW * 110) / 72, -1); // just the visible half, at 110 ppi
    scanned.destroy();
    doc.destroy();
  });
  it('cuts a photo spread into two smaller photos', async () => {
    const img = engine.addImage(fixture('spread.jpg'));
    const halves = splitPage(refs(img.sourceId, 1)[0], 0.5, { overlap: 0, rightFirst: false }, false, uid);
    const opts2 = { dpi: 150, format: 'jpg' as const, jpegQuality: 90, maxPixels: 25e6 };
    const whole = new mupdf.Image(new Uint8Array(engine.renderImage({ sourceId: img.sourceId, srcIndex: 0, addedRotation: 0 }, opts2).bytes));
    const left = new mupdf.Image(new Uint8Array(engine.renderImage({ sourceId: img.sourceId, srcIndex: 0, addedRotation: 0, edit: editOf(halves[0]) }, opts2).bytes));
    expect(left.getWidth()).toBeCloseTo(whole.getWidth() / 2, -1);
    expect(left.getHeight()).toBe(whole.getHeight());
    whole.destroy();
    left.destroy();
  });
});

describe('page model', () => {
  const page = (): PageRef => ({ uid: uid(), sourceId: 's1', srcIndex: 0, addedRotation: 0 });
  it('one undo reverses a whole batch split', () => {
    let pages = [page(), page(), page()];
    const plan = { split: new Map([[pages[0].uid, { at: 0.5, review: false }], [pages[2].uid, { at: 0.48, review: true }]]), unclear: 0, portrait: 0, oneSided: 0 };
    let h: model.History = { undo: [], redo: [] };
    const next = applyPlan(pages, plan, new Map([[pages[2].uid, -1.5]]), choice, uid);
    h = model.pushHistory(h, pages);
    const before = pages;
    pages = next;
    expect(pages.length).toBe(5);
    expect(pages[3]).toMatchObject({ review: true, fineRotation: -1.5, spread: { side: 'left', at: 0.48 } });
    const u = model.undo(h, pages)!;
    expect(u.pages).toBe(before);
    expect(model.redo(u.history, u.pages)!.pages).toBe(next);
  });
  it('a split can be adjusted or taken back, wherever its halves have moved', () => {
    const p = page();
    const halves = splitPage(p, 0.5, choice, true, uid);
    let pages = [halves[1], page(), halves[0]];
    const id = halves[0].spread!.id;
    pages = resplit(pages, id, 0.45, choice);
    expect(pages.filter((q) => q.spread?.id === id).map((q) => [q.spread!.side, q.review, q.spread!.at])).toEqual([['left', undefined, 0.45], ['right', undefined, 0.45]]);
    pages = mergeSpread(pages, id);
    expect(pages.length).toBe(2);
    expect({ ...pages[0], uid: p.uid }).toEqual(p);
  });
});
