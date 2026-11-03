// Golden-rule regression check: exporting the existing fixtures with untouched pages must give the
// same result as before the straighten and split features were added. The baseline in
// tests/fixtures/regression-baseline.json was recorded with the code as it was before those
// features (RECORD_BASELINE=1 npx vitest run tests/unit/regression.test.ts rewrites it).
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as mupdf from 'mupdf';
import * as engine from '../../src/worker/engine';
import { setFontFetcher } from '../../src/worker/convert';
import { planFor } from '../../src/lib/compression';
import { DEFAULTS, marginPtFor } from '../../src/lib/settings';
import type { CompressionLevel, ExportPage, OpenResult, Rotation } from '../../src/lib/types';

const BASELINE = new URL('../fixtures/regression-baseline.json', import.meta.url);
const RECORD = process.env.RECORD_BASELINE === '1';

const read = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url));
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex').slice(0, 16);

setFontFetcher(async (file) => buf(readFileSync(new URL(`../../public/fonts/${file}.ttf`, import.meta.url))));

type Summary = { pages: number; rotate: number[]; text: string[]; size: number };
type Case = { name: string; inputs: string[]; level: CompressionLevel; rotate?: Rotation[]; margin?: 'none' | 'small' | 'medium'; size?: 'A4' | 'original' };

const PDFS = ['tamil-unicode.pdf', 'english-cjk.pdf', 'text-50.pdf', 'text-200.pdf', 'photo-heavy.pdf', 'scanned.pdf', 'bookmarks-links-form.pdf', 'damaged.pdf'];
const IMAGES = ['phone-portrait-exif6.jpg', 'phone-portrait-exif8.jpg', 'phone-landscape-exif1.jpg', 'phone-landscape-exif3.jpg', 'transparent.png', 'plain.png'];
const LEVELS: CompressionLevel[] = ['lossless', 'balanced', 'strong', 'scan'];

const CASES: Case[] = [
  ...PDFS.map((f): Case => ({ name: `${f} lossless`, inputs: [f], level: 'lossless' })),
  ...['photo-heavy.pdf', 'scanned.pdf', 'tamil-unicode.pdf'].flatMap((f) => LEVELS.slice(1).map((level): Case => ({ name: `${f} ${level}`, inputs: [f], level }))),
  { name: 'password-mango.pdf lossless', inputs: ['password-mango.pdf'], level: 'lossless' },
  { name: 'owner-restricted.pdf lossless (allowed)', inputs: ['owner-restricted.pdf'], level: 'lossless' },
  ...IMAGES.map((f): Case => ({ name: `${f} A4`, inputs: [f], level: 'lossless' })),
  { name: 'images original size, medium margin', inputs: IMAGES, level: 'lossless', size: 'original', margin: 'medium' },
  { name: 'images balanced', inputs: IMAGES, level: 'balanced' },
  { name: 'sample.docx', inputs: ['sample.docx'], level: 'lossless' },
  { name: 'sample.txt', inputs: ['sample.txt'], level: 'lossless' },
  {
    name: 'merge with added rotations',
    inputs: ['tamil-unicode.pdf', 'phone-portrait-exif6.jpg', 'english-cjk.pdf', 'scanned.pdf'],
    level: 'lossless',
    rotate: [90, 0, 180, 270, 90, 0, 0, 180, 270, 90, 0, 0],
  },
];

async function load(f: string): Promise<ExportPage[]> {
  if (f.endsWith('.jpg') || f.endsWith('.png')) return [{ sourceId: engine.addImage(buf(read(f))).sourceId, srcIndex: 0, addedRotation: 0 }];
  let r: OpenResult;
  if (f.endsWith('.docx')) r = await engine.convert('docx', buf(read(f)));
  else if (f.endsWith('.txt')) r = await engine.convert('text', buf(read(f)));
  else {
    r = engine.open(buf(read(f)), false);
    if (r.status === 'needs-password') r = engine.unlock(r.sourceId, 'mango', false);
  }
  if (r.status !== 'ok') throw new Error(`${f}: ${r.status}`);
  const { sourceId, pageCount } = r;
  return Array.from({ length: pageCount }, (_, i) => ({ sourceId, srcIndex: i, addedRotation: 0 as Rotation }));
}

function summarise(bytes: ArrayBuffer): Summary {
  const doc = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf').asPDF()!;
  try {
    const n = doc.countPages();
    const rotate: number[] = [];
    const text: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = doc.findPage(i).getInheritable('Rotate');
      rotate.push(r.isNumber() ? r.asNumber() : 0);
      const page = doc.loadPage(i);
      const st = page.toStructuredText('preserve-whitespace');
      text.push(sha(st.asText()));
      st.destroy();
      page.destroy();
    }
    return { pages: n, rotate, text, size: bytes.byteLength };
  } finally {
    doc.destroy();
  }
}

async function run(c: Case): Promise<Summary> {
  const pages: ExportPage[] = [];
  for (const f of c.inputs) pages.push(...(await load(f)));
  c.rotate?.forEach((r, i) => pages[i] && (pages[i].addedRotation = r));
  const r = await engine.exportPdf(
    pages,
    { plan: planFor(c.level, DEFAULTS), imagePageSize: c.size ?? 'A4', marginPt: marginPtFor(DEFAULTS, c.margin ?? 'none'), creditLine: DEFAULTS.creditLine, title: 'Regression' },
    () => {},
  );
  return summarise(r.bytes);
}

const fixtureHashes = () => Object.fromEntries([...new Set(CASES.flatMap((c) => c.inputs))].sort().map((f) => [f, sha(read(f))]));

afterEach(() => engine.reset());

if (RECORD) {
  it('records the baseline', async () => {
    const results: Record<string, Summary> = {};
    for (const c of CASES) results[c.name] = await run(c);
    writeFileSync(BASELINE, JSON.stringify({ fixtures: fixtureHashes(), results }, null, 1) + '\n');
  }, 120_000);
} else {
  describe('exports of unedited pages match the recorded baseline', () => {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as { fixtures: Record<string, string>; results: Record<string, Summary> };
    it('fixtures are the ones the baseline was recorded with', () => {
      expect(fixtureHashes()).toEqual(base.fixtures);
    });
    for (const c of CASES) {
      it(c.name, async () => {
        const got = await run(c);
        const want = base.results[c.name];
        expect(want, 'case missing from the baseline').toBeDefined();
        expect(got.pages).toBe(want.pages);
        expect(got.rotate).toEqual(want.rotate);
        expect(got.text).toEqual(want.text);
        expect(Math.abs(got.size - want.size) / want.size).toBeLessThanOrEqual(0.01);
      }, 60_000);
    }
  });
}
