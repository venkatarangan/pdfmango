// Straighten and fine rotation: the tilt detector on the test scans, the rotation maths, and
// export with real text kept as text.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import * as engine from '../../src/worker/engine';
import { planFor } from '../../src/lib/compression';
import { DEFAULTS, marginPtFor } from '../../src/lib/settings';
import * as model from '../../src/lib/model';
import { apply, concat, editOf, invert, rotationAbout, setFineRotations, userSpaceRotation, withFineRotation, type Matrix } from '../../src/lib/edits';
import type { ExportPage, OpenResult, PageRef } from '../../src/lib/types';

const fixture = (f: string) => {
  const b = readFileSync(new URL(`../fixtures/${f}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const ok = (r: OpenResult) => {
  if (r.status !== 'ok') throw new Error(r.status);
  return r;
};
const exportOpts = (level: 'lossless' | 'balanced' = 'lossless') => ({ plan: planFor(level, DEFAULTS), imagePageSize: 'A4' as const, marginPt: marginPtFor(DEFAULTS, 'none'), creditLine: '' });
const words = (t: string) => t.replace(/\s+/g, ' ').trim();
const pageText = (bytes: ArrayBuffer, i: number) => {
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

describe('tilt detector', () => {
  it('recovers the tilt of scanned pages within 0.2°', () => {
    const { sourceId } = ok(engine.open(fixture('tilted-scans.pdf')));
    [2, 5, -8].forEach((tilt, i) => {
      const r = engine.detectSkew(sourceId, i);
      expect(r.verdict).toBe('tilted');
      expect(Math.abs(r.angle - tilt)).toBeLessThanOrEqual(0.2);
    });
  });
  it('recovers the tilt of a text page', () => {
    const { sourceId } = ok(engine.open(fixture('tamil-tilted.pdf')));
    const r = engine.detectSkew(sourceId, 0);
    expect(Math.abs(r.angle - 3)).toBeLessThanOrEqual(0.2);
  });
  it('leaves a photo with no text alone', () => {
    const { sourceId } = ok(engine.open(fixture('photo-no-text.pdf')));
    expect(engine.detectSkew(sourceId, 0)).toMatchObject({ angle: 0, verdict: 'unsure' });
    const img = engine.addImage(fixture('plain.png'));
    expect(engine.detectSkew(img.sourceId, 0).angle).toBe(0);
  });
  it('says a straight page is straight', () => {
    const { sourceId } = ok(engine.open(fixture('text-50.pdf')));
    expect(engine.detectSkew(sourceId, 0)).toMatchObject({ angle: 0, verdict: 'straight' });
    const scan = ok(engine.open(fixture('scanned.pdf')));
    expect(engine.detectSkew(scan.sourceId, 0).angle).toBe(0);
  });
  it('measures a turned page again from scratch (ignores its current fine rotation)', () => {
    const { sourceId } = ok(engine.open(fixture('tilted-scans.pdf')));
    expect(Math.abs(engine.detectSkew(sourceId, 1, { fineRotation: -5 }).angle - 5)).toBeLessThanOrEqual(0.2);
  });
  it('measures the page as it shows, with its added quarter turns', () => {
    const { sourceId } = ok(engine.open(fixture('tilted-scans.pdf')));
    expect(engine.detectSkew(sourceId, 1, undefined, 180).angle).toBeCloseTo(5, 1); // upside down: same tilt
    expect(engine.detectSkew(sourceId, 1, undefined, 90).verdict).toBe('unsure'); // turned sideways: lines run down the page
  });
  it('finds the angle of one page in under a second', () => {
    const { sourceId } = ok(engine.open(fixture('tilted-scans.pdf')));
    const t = performance.now();
    engine.detectSkew(sourceId, 2);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('rotation maths', () => {
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  it('turns about the centre, clockwise on screen', () => {
    const m = rotationAbout([0, 0, 200, 100], 90);
    close(apply(m, 100, 50), [100, 50]);
    close(apply(m, 200, 50), [100, 150]); // the right edge turns down (y grows downwards)
  });
  it('maps the same turn into PDF user space, including pages with /Rotate 90', () => {
    // A 600 x 800 pt page with /Rotate 90 draws as 800 x 600: user (x, y) -> drawing (y, x).
    const T: Matrix = [0, 1, 1, 0, 0, 0];
    const b: [number, number, number, number] = [0, 0, 800, 600];
    const U = userSpaceRotation(T, b, 7);
    const D = rotationAbout(b, 7);
    for (const [x, y] of [[0, 0], [600, 0], [123, 456]]) close(apply(concat(U, T), x, y), apply(D, ...apply(T, x, y)));
    close(concat(invert(U), U), [1, 0, 0, 1, 0, 0]);
  });
});

describe('export with fine rotation', () => {
  it('straightens the Tamil page and keeps its text identical and selectable', async () => {
    const orig = ok(engine.open(fixture('tamil-unicode.pdf')));
    const want = words(pageText(fixture('tamil-unicode.pdf'), 0));
    const tilted = ok(engine.open(fixture('tamil-tilted.pdf')));
    const angle = engine.detectSkew(tilted.sourceId, 0).angle;
    const pages: ExportPage[] = [{ sourceId: tilted.sourceId, srcIndex: 0, addedRotation: 0, edit: { fineRotation: -angle } }];
    const r = await engine.exportPdf(pages, exportOpts(), () => {});
    expect(words(pageText(r.bytes, 0))).toBe(want);
    // Measured again, the exported page is straight.
    const back = ok(engine.open(r.bytes));
    expect(engine.detectSkew(back.sourceId, 0).verdict).toBe('straight');
    expect(back.pageSizes[0]).toEqual(orig.pageSizes[0]);
  });
  it('keeps the page count and size, and works on scans, photos and with compression', async () => {
    const scans = ok(engine.open(fixture('tilted-scans.pdf')));
    const photo = engine.addImage(fixture('phone-landscape-exif3.jpg'));
    const pages: ExportPage[] = [
      ...[2, 5, -8].map((a, i): ExportPage => ({ sourceId: scans.sourceId, srcIndex: i, addedRotation: 0, edit: { fineRotation: -a } })),
      { sourceId: photo.sourceId, srcIndex: 0, addedRotation: 90, edit: { fineRotation: 4 } },
    ];
    for (const level of ['lossless', 'balanced'] as const) {
      const r = await engine.exportPdf(pages, exportOpts(level), () => {});
      const back = ok(engine.open(r.bytes));
      expect(back.pageCount).toBe(4);
      back.pageSizes.slice(0, 3).forEach((s, i) => expect(s).toEqual(scans.pageSizes[i]));
      for (let i = 0; i < 3; i++) expect(engine.detectSkew(back.sourceId, i).verdict).toBe('straight');
    }
  });
});

describe('page model', () => {
  const page = (uid: string): PageRef => ({ uid, sourceId: 's1', srcIndex: 0, addedRotation: 0 });
  it('stores no field for an untouched or reset page', () => {
    expect(editOf(page('a'))).toBeUndefined();
    const turned = withFineRotation(page('a'), 3.456);
    expect(turned.fineRotation).toBe(3.46);
    expect(Object.keys(withFineRotation(turned, 0))).not.toContain('fineRotation');
  });
  it('undo and redo walk through fine rotations', () => {
    let pages = [page('a'), page('b')];
    let h: model.History = { undo: [], redo: [] };
    const next = setFineRotations(pages, new Map([['a', -2], ['b', 5]]));
    h = model.pushHistory(h, pages);
    pages = next;
    expect(pages.map((p) => p.fineRotation)).toEqual([-2, 5]);
    const u = model.undo(h, pages)!;
    expect(u.pages.map((p) => p.fineRotation)).toEqual([undefined, undefined]);
    const r = model.redo(u.history, u.pages)!;
    expect(r.pages.map((p) => p.fineRotation)).toEqual([-2, 5]);
  });
  it('makes no edit when nothing changes', () => {
    const pages = [page('a')];
    expect(setFineRotations(pages, new Map([['a', 0]]))).toBe(pages);
  });
});
