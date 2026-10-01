// Runs the real worker engine in Node against the fixtures.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import * as engine from '../../src/worker/engine';
import type { ExportOptions, ExportPage, OpenResult } from '../../src/lib/types';

const fixture = (f: string) => {
  const b = readFileSync(new URL(`../fixtures/${f}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const opts = (o: Partial<ExportOptions> = {}): ExportOptions => ({ level: 'lossless', imagePageSize: 'A4', imageMargin: 'none', ...o });
const ok = (r: OpenResult) => {
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
  return r;
};
const reopen = (bytes: ArrayBuffer) => mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf').asPDF()!;
const text = (doc: mupdf.PDFDocument, i: number) => {
  const p = doc.loadPage(i);
  const st = p.toStructuredText('preserve-whitespace');
  const t = st.asText();
  st.destroy();
  p.destroy();
  return t;
};
const noProgress = () => {};

afterEach(() => engine.reset());

describe('open', () => {
  it('returns page sizes and no notices for a normal PDF', () => {
    const r = ok(engine.open(fixture('text-50.pdf')));
    expect(r.pageCount).toBe(50);
    expect(r.pageSizes[0][0]).toBeCloseTo(595.92, 0);
    expect(r.notices).toMatchObject({ wasRepaired: false, hasOutline: false, hasForm: false, isSigned: false, restricted: false });
  });
  it('asks for a password, rejects a wrong one, accepts the right one', () => {
    const r = engine.open(fixture('password-mango.pdf'));
    expect(r.status).toBe('needs-password');
    expect(engine.unlock(r.sourceId, 'nope')).toMatchObject({ status: 'needs-password', wrongPassword: true });
    const u = ok(engine.unlock(r.sourceId, 'mango'));
    expect(u.pageCount).toBe(3);
    expect(u.notices.wasEncrypted).toBe(true);
  });
  it('refuses an owner-restricted PDF by default', () => {
    expect(engine.open(fixture('owner-restricted.pdf')).status).toBe('restricted');
  });
  it('repairs a damaged PDF and says so', () => {
    const r = ok(engine.open(fixture('damaged.pdf')));
    expect(r.pageCount).toBe(50);
    expect(r.notices.wasRepaired).toBe(true);
  });
  it('reports bookmarks and forms', () => {
    expect(ok(engine.open(fixture('bookmarks-links-form.pdf'))).notices).toMatchObject({ hasOutline: true, hasForm: true });
  });
  it('throws a code for garbage', () => {
    expect(() => engine.open(new TextEncoder().encode('%PDF-1.7 nothing here').buffer as ArrayBuffer)).toThrow(/unreadable/);
  });
});

describe('addImage', () => {
  it('reports the displayed (EXIF-rotated) size', () => {
    expect(engine.addImage(fixture('phone-portrait-exif6.jpg'))).toMatchObject({ widthPx: 1200, heightPx: 1600 });
    expect(engine.addImage(fixture('phone-landscape-exif3.jpg'))).toMatchObject({ widthPx: 1600, heightPx: 1200 });
  });
  it('rejects a broken image', () => {
    expect(() => engine.addImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer)).toThrow(/image-unreadable/);
  });
});

describe('export', () => {
  it('merges in the given order, applies rotation on top of the original, drops unlisted pages', async () => {
    const t = ok(engine.open(fixture('tamil-unicode.pdf')));
    const c = ok(engine.open(fixture('english-cjk.pdf')));
    const pages: ExportPage[] = [
      { sourceId: t.sourceId, srcIndex: 2, addedRotation: 90 },
      { sourceId: c.sourceId, srcIndex: 0, addedRotation: 0 },
      { sourceId: t.sourceId, srcIndex: 0, addedRotation: 270 },
    ];
    const r = await engine.exportPdf(pages, opts(), noProgress);
    const out = reopen(r.bytes);
    expect(out.countPages()).toBe(3);
    expect([0, 1, 2].map((i) => out.findPage(i).get('Rotate').asNumber())).toEqual([90, 0, 270]);
    expect(text(out, 0)).toContain('பாரதியார்');
    expect(text(out, 1)).toContain('这是一个测试文件');
    expect(text(out, 2)).toContain('அகர முதல');
    out.destroy();
  });

  it('builds image pages: A4 orientation follows the photo, margins, original size', async () => {
    const portrait = engine.addImage(fixture('phone-portrait-exif6.jpg'));
    const land = engine.addImage(fixture('phone-landscape-exif1.jpg'));
    const pages = [portrait, land].map((s) => ({ sourceId: s.sourceId, srcIndex: 0, addedRotation: 0 as const }));
    const sizes = async (o: Partial<ExportOptions>) => {
      const out = reopen((await engine.exportPdf(pages, opts(o), noProgress)).bytes);
      const s = [0, 1].map((i) => {
        const p = out.loadPage(i);
        const b = p.getBounds();
        p.destroy();
        return [Math.round(b[2] - b[0]), Math.round(b[3] - b[1])];
      });
      out.destroy();
      return s;
    };
    expect(await sizes({})).toEqual([[595, 842], [842, 595]]);
    expect(await sizes({ imagePageSize: 'original', imageMargin: 'small' })).toEqual([[1200 + 36, 1600 + 36], [1600 + 36, 1200 + 36]]);
  });

  it('JPEG pages embed the original scan data (no re-encode) without EXIF', async () => {
    const src = new Uint8Array(fixture('phone-portrait-exif6.jpg'));
    const s = engine.addImage(src.buffer.slice(0) as ArrayBuffer);
    const out = reopen((await engine.exportPdf([{ sourceId: s.sourceId, srcIndex: 0, addedRotation: 0 }], opts(), noProgress)).bytes);
    let found: Uint8Array | undefined;
    out.findPage(0).get('Resources').get('XObject').forEach((v) => (found = v.readRawStream().asUint8Array().slice()));
    out.destroy();
    expect(found).toBeDefined();
    expect(found!.length).toBeLessThan(src.length);
    expect(Buffer.from(found!.subarray(-5000)).equals(Buffer.from(src.subarray(-5000)))).toBe(true);
    expect(Buffer.from(found!).includes(Buffer.from('Exif'))).toBe(false);
  });

  it('Balanced shrinks a photo-heavy PDF by at least 40% and keeps text', async () => {
    const p = ok(engine.open(fixture('photo-heavy.pdf')));
    const pages = Array.from({ length: p.pageCount }, (_, i) => ({ sourceId: p.sourceId, srcIndex: i, addedRotation: 0 as const }));
    const steps = new Set<string>();
    const r = await engine.exportPdf(pages, opts({ level: 'balanced' }), (pr) => steps.add(pr.step.replace(/\d+/g, '#')));
    const input = fixture('photo-heavy.pdf').byteLength;
    expect(r.outputSize).toBeLessThan(input * 0.6);
    expect(r.fellBackToLossless).toBe(false);
    expect([...steps]).toEqual(expect.arrayContaining(['Copying pages # of #', 'Compressing images # of #']));
    const out = reopen(r.bytes);
    expect(out.countPages()).toBe(12);
    expect(text(out, 0)).toContain('Photo 1');
    out.destroy();
  }, 60_000);

  it('Scan removes the text layer; the safety net returns Lossless when Scan would be bigger', async () => {
    const t = ok(engine.open(fixture('tamil-unicode.pdf')));
    const pages = [0, 1, 2].map((i) => ({ sourceId: t.sourceId, srcIndex: i, addedRotation: 0 as const }));
    const lossless = await engine.exportPdf(pages, opts(), noProgress);
    const scan = await engine.exportPdf(pages, opts({ level: 'scan' }), noProgress);
    // A small text-only file is smaller as text than as pictures.
    expect(scan.fellBackToLossless).toBe(true);
    expect(scan.outputSize).toBe(lossless.outputSize);

    const s = ok(engine.open(fixture('scanned.pdf')));
    const sp = [0, 1].map((i) => ({ sourceId: s.sourceId, srcIndex: i, addedRotation: 0 as const }));
    const r = await engine.exportPdf(sp, opts({ level: 'scan' }), noProgress);
    expect(r.fellBackToLossless).toBe(false);
    const out = reopen(r.bytes);
    expect(text(out, 0).trim()).toBe('');
    out.destroy();
  }, 60_000);

  it('Tamil text is byte-identical after merge and Balanced', async () => {
    const t = ok(engine.open(fixture('tamil-unicode.pdf')));
    const src = reopen(fixture('tamil-unicode.pdf'));
    const pages = [1, 0, 2].map((i) => ({ sourceId: t.sourceId, srcIndex: i, addedRotation: 0 as const }));
    const out = reopen((await engine.exportPdf(pages, opts({ level: 'balanced' }), noProgress)).bytes);
    [1, 0, 2].forEach((srcIdx, k) => expect(text(out, k)).toBe(text(src, srcIdx)));
    expect(text(out, 0)).toContain('யாதும் ஊரே யாவரும் கேளிர்');
    out.destroy();
    src.destroy();
  });

  it('cancel stops a running export', async () => {
    const p = ok(engine.open(fixture('text-200.pdf')));
    const pages = Array.from({ length: 200 }, (_, i) => ({ sourceId: p.sourceId, srcIndex: i, addedRotation: 0 as const }));
    let first = true;
    const run = engine.exportPdf(pages, opts({ level: 'scan' }), () => {
      if (first) {
        first = false;
        setTimeout(() => engine.cancel(), 0);
      }
    });
    await expect(run).rejects.toThrow(/cancelled/);
  }, 60_000);
});
