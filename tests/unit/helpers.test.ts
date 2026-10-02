import { describe, expect, it } from 'vitest';
import { baseName, defaultFileName, finalFileName } from '../../src/lib/filenames';
import { checkPages, checkSize, isMobile, sizeLimit } from '../../src/lib/limits';
import { sniff } from '../../src/lib/filetypes';
import { emailVerdict, formatBytes, resultLine } from '../../src/lib/format';
import { planFor } from '../../src/lib/compression';
import { DEFAULTS, marginPtFor } from '../../src/lib/settings';

describe('file names', () => {
  it('one PDF -> <original>-edited.pdf', () => {
    expect(defaultFileName([{ name: 'Annual Report.pdf', kind: 'pdf' }])).toBe('Annual Report-edited.pdf');
  });
  it('several sources with a PDF -> merged.pdf', () => {
    expect(defaultFileName([{ name: 'a.pdf', kind: 'pdf' }, { name: 'b.pdf', kind: 'pdf' }])).toBe('merged.pdf');
    expect(defaultFileName([{ name: 'a.pdf', kind: 'pdf' }, { name: 'b.jpg', kind: 'image' }])).toBe('merged.pdf');
  });
  it('images only -> images.pdf', () => {
    expect(defaultFileName([{ name: 'a.jpg', kind: 'image' }])).toBe('images.pdf');
    expect(defaultFileName([{ name: 'a.jpg', kind: 'image' }, { name: 'b.png', kind: 'image' }])).toBe('images.pdf');
  });
  it('keeps Unicode names and strips unsafe characters', () => {
    expect(baseName('தமிழ் ஆவணம்.pdf')).toBe('தமிழ் ஆவணம்');
    expect(baseName('a/b:c*?.pdf')).toBe('a b c');
    expect(baseName('.pdf')).toBe('document');
  });
  it('finalFileName always ends in .pdf and keeps dots inside', () => {
    expect(finalFileName('report.v2', 'x.pdf')).toBe('report.v2.pdf');
    expect(finalFileName('Report.PDF', 'x.pdf')).toBe('Report.pdf');
    expect(finalFileName('   ', 'merged.pdf')).toBe('merged.pdf');
  });
});

describe('device limits', () => {
  it('detects phones by UA-CH or coarse pointer without hover', () => {
    expect(isMobile({ userAgentDataMobile: true })).toBe(true);
    expect(isMobile({ coarseNoHover: true })).toBe(true);
    expect(isMobile({ userAgentDataMobile: false, coarseNoHover: false })).toBe(false);
  });
  it('50 MB on phones and low-memory devices, 250 MB on computers', () => {
    expect(sizeLimit({ coarseNoHover: true }, DEFAULTS).maxMB).toBe(50);
    expect(sizeLimit({ deviceMemoryGB: 4 }, DEFAULTS).maxMB).toBe(50);
    expect(sizeLimit({ deviceMemoryGB: 8 }, DEFAULTS).maxMB).toBe(250);
    expect(sizeLimit({}, DEFAULTS).maxMB).toBe(250);
  });
  it('refuses a file that takes the session past the limit, naming it', () => {
    const phone = sizeLimit({ coarseNoHover: true }, DEFAULTS);
    expect(checkSize(phone, 40 * 1048576, 10 * 1048576)).toBeNull();
    expect(checkSize(phone, 40 * 1048576, 11 * 1048576)).toMatch(/50 MB.*computer/);
  });
  it('refuses page 1,001', () => {
    expect(checkPages(990, 10)).toBeNull();
    expect(checkPages(990, 11)).toMatch(/1,000 pages.*1,001/);
  });
});

const bytes = (s: string, pad = 16) => {
  const b = new Uint8Array(Math.max(s.length, pad));
  [...s].forEach((c, i) => (b[i] = c.charCodeAt(0)));
  return b;
};

describe('file type sniffing', () => {
  it('recognises PDF, JPEG and PNG by content', () => {
    expect(sniff(bytes('%PDF-1.7'), 'x.bin').kind).toBe('pdf');
    expect(sniff(bytes('\n\n  %PDF-1.4'), 'x.pdf').kind).toBe('pdf');
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), 'x.png')).toEqual({ kind: 'image', mime: 'image/jpeg' });
    expect(sniff(bytes('\x89PNG\r\n\x1a\n'), 'x')).toEqual({ kind: 'image', mime: 'image/png' });
  });
  it('rejects HEIC and WebP with the convert hint', () => {
    expect(sniff(bytes('\0\0\0\x18ftypheic'), 'IMG_1.HEIC')).toMatchObject({ kind: 'rejected', message: expect.stringContaining('convert to JPG or PNG first') });
    expect(sniff(bytes('RIFF\0\0\0\0WEBPVP8 '), 'a.webp')).toMatchObject({ kind: 'rejected', message: expect.stringContaining('convert to JPG or PNG first') });
  });
  it('rejects other files with a one-line message', () => {
    expect(sniff(bytes('PK\x03\x04'), 'notes.docx')).toMatchObject({ kind: 'rejected', message: 'notes.docx: PDFMango opens PDF, JPG and PNG files.' });
  });
});

describe('format', () => {
  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(4.2 * 1048576)).toBe('4.2 MB');
    expect(formatBytes(250 * 1048576)).toBe('250 MB');
  });
  it('builds the result line', () => {
    expect(resultLine(4.2 * 1048576, 1.1 * 1048576)).toBe('4.2 MB → 1.1 MB, 74% smaller');
    expect(resultLine(1048576, 1100000)).toBe('1.0 MB → 1.0 MB');
  });
});

describe('compression options', () => {
  it('maps levels to engine plans from the config', () => {
    expect(planFor('lossless', DEFAULTS)).toEqual({ kind: 'lossless' });
    expect(planFor('balanced', DEFAULTS)).toEqual({ kind: 'downsample', ppi: 150, quality: 75, subsetFonts: true });
    expect(planFor('strong', DEFAULTS)).toEqual({ kind: 'downsample', ppi: 96, quality: 55, subsetFonts: true });
    expect(planFor('scan', DEFAULTS)).toEqual({ kind: 'scan', ppi: 110, quality: 60 });
  });
  it('maps margins to points', () => {
    expect([marginPtFor(DEFAULTS, 'none'), marginPtFor(DEFAULTS, 'small'), marginPtFor(DEFAULTS, 'medium')]).toEqual([0, 18, 36]);
  });
});

describe('emailVerdict', () => {
  it('says whether the file suits email', () => {
    expect(emailVerdict(570 * 1024)).toEqual({ text: 'Small enough to email', ok: true });
    expect(emailVerdict(10 * 1048576)).toMatchObject({ ok: true });
    expect(emailVerdict(15 * 1048576).text).toMatch(/some email/);
    expect(emailVerdict(30 * 1048576).text).toMatch(/most email/);
  });
});
