// Word (.docx) and text (.txt) files become PDF pages here, inside the worker. Both are turned into
// HTML, laid out by MuPDF on A4 pages, written out as a PDF and reopened, so from then on they are
// ordinary PDF sources. Every MuPDF object created here is destroyed here, except the returned document.
import * as mupdf from 'mupdf';
import { SCRIPT_FONTS, scriptsIn, type ScriptFont } from '../lib/scripts';

const A4: [number, number] = [595, 842];
const BODY_PT = 11;

// Word's default 1-inch margins; tables and pictures stay inside the text area.
const CSS = `
@page { margin: 72pt }
body { margin: 0; font-family: sans-serif; font-size: ${BODY_PT}pt; line-height: 1.35 }
p { margin: 0 0 6pt }
h1 { font-size: 18pt; margin: 12pt 0 6pt }
h2 { font-size: 15pt; margin: 12pt 0 6pt }
h3, h4, h5, h6 { font-size: 12pt; margin: 10pt 0 4pt }
table { border-collapse: collapse; margin: 6pt 0 }
td, th { border: 0.75pt solid #444; padding: 3pt 5pt; vertical-align: top }
img { max-width: 100% }
pre.txt { margin: 0; white-space: pre-wrap; font-family: sans-serif }
`;

// ---- Fonts for scripts the engine lacks ----------------------------------------------------------

/** Fetches a font file by name (without .ttf); null when unavailable. Tests replace this. */
export type FontFetcher = (file: string) => Promise<ArrayBuffer | null>;

let fetchFont: FontFetcher = async (file) => {
  try {
    const res = await fetch(new URL(`/fonts/${file}.ttf`, self.location.origin));
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null; // offline and never fetched before: the text falls back to the built-in fonts
  }
};

export function setFontFetcher(f: FontFetcher) {
  fetchFont = f;
}

const fonts = new Map<string, mupdf.Font>(); // `${script}|${bold}` -> font, loaded once per worker
let hookInstalled = false;

/** Makes sure the Regular and Bold fonts for every script in `text` are loaded before layout. */
async function loadFontsFor(text: string) {
  const needed: [ScriptFont, boolean][] = scriptsIn(text).flatMap((s) => [[s, false], [s, true]] as [ScriptFont, boolean][]);
  await Promise.all(
    needed
      .filter(([s, bold]) => !fonts.has(key(s.script, bold)))
      .map(async ([s, bold]) => {
        const name = `${s.file}-${bold ? 'Bold' : 'Regular'}`;
        const data = await fetchFont(name);
        if (data) fonts.set(key(s.script, bold), new mupdf.Font(name, new Uint8Array(data)));
      }),
  );
  if (!hookInstalled) {
    // MuPDF asks for a font whenever a character's script has none; the loader must answer at once.
    mupdf.installLoadFontFunction((_name, script, bold) => {
      const s = SCRIPT_FONTS.find((f) => f.script.toLowerCase() === String(script).toLowerCase());
      return s ? (fonts.get(key(s.script, !!bold)) ?? fonts.get(key(s.script, false)) ?? null) : null;
    });
    hookInstalled = true;
  }
}

const key = (script: string, bold: boolean) => `${script}|${bold}`;

// ---- HTML → PDF --------------------------------------------------------------------------------------

/** Lays HTML out on A4 pages and returns a new PDF holding them, with fonts cut to the characters used. */
export async function htmlToPdf(html: string, yieldNow: () => Promise<void>): Promise<mupdf.PDFDocument> {
  await loadFontsFor(html);
  mupdf.setUserCSS(CSS); // deprecated in favour of per-document styling, but the only route in MuPDF.js 1.28
  const doc = mupdf.Document.openDocument(new TextEncoder().encode(html), 'text/html');
  const buf = new mupdf.Buffer();
  try {
    doc.layout(A4[0], A4[1], BODY_PT);
    const glyphText = new GlyphText();
    const writer = new mupdf.DocumentWriter(buf, 'pdf', '');
    try {
      const n = doc.countPages();
      for (let i = 0; i < n; i++) {
        await yieldNow();
        const page = doc.loadPage(i);
        try {
          glyphText.collect(page);
          const dev = writer.beginPage(page.getBounds());
          page.run(dev, mupdf.Matrix.identity);
          writer.endPage();
        } finally {
          page.destroy();
        }
      }
      writer.close();
    } finally {
      writer.destroy();
    }
    const written = mupdf.Document.openDocument(buf.asUint8Array().slice(), 'application/pdf').asPDF()!;
    try {
      glyphText.fixToUnicode(written);
      // Whole fonts are embedded at first (the CJK fallback alone is 3.5 MB); keep only what is used.
      written.subsetFonts();
      const saved = written.saveToBuffer('garbage=4,compress');
      try {
        return mupdf.Document.openDocument(saved.asUint8Array().slice(), 'application/pdf').asPDF()!;
      } finally {
        saved.destroy();
      }
    } finally {
      written.destroy();
    }
  } finally {
    buf.destroy();
    doc.destroy();
  }
}

// ---- Copyable text for joined letters -----------------------------------------------------------

/**
 * Tamil, Hindi and other scripts often draw several letters as one glyph (க + ் → க்). MuPDF's PDF
 * writer builds each font's ToUnicode map from the font alone, so those glyphs copy and search as
 * "�". Layout knows better: each glyph arrives with its letter, followed by glyph -1 entries for
 * the extra letters it stands for. This records that per font and fills in the glyphs the map lacks.
 * Glyphs that already map to a letter keep it, so a two-part vowel (கொ, drawn ெ க ா) copies in visual
 * order, as in most PDFs, rather than as letters attached to the wrong pieces.
 */
class GlyphText {
  private byFont = new Map<string, Map<number, string>>();

  collect(page: mupdf.Page) {
    const dev = new mupdf.Device({
      fillText: (text) => {
        let font = '';
        let gid = -1;
        let str = '';
        const flush = () => {
          if (gid < 0 || !str) return;
          let m = this.byFont.get(font);
          if (!m) this.byFont.set(font, (m = new Map()));
          if (!m.has(gid)) m.set(gid, str); // a glyph keeps the first text it was drawn for
        };
        text.walk({
          showGlyph: (f, _trm, glyph, unicode) => {
            if (glyph < 0) {
              if (unicode > 0) str += String.fromCodePoint(unicode);
              return;
            }
            flush();
            font = f.getName();
            gid = glyph;
            str = unicode > 0 ? String.fromCodePoint(unicode) : '';
          },
        });
        flush();
      },
    });
    try {
      page.run(dev, mupdf.Matrix.identity);
      dev.close();
    } finally {
      dev.destroy();
    }
  }

  /** Replaces the ToUnicode map of each written Type0 font with what layout recorded for it. */
  fixToUnicode(pdf: mupdf.PDFDocument) {
    const done = new Set<number>();
    for (let i = 0; i < pdf.countPages(); i++) {
      pdf.findPage(i).get('Resources').get('Font').forEach((ref) => {
        if (!ref.isIndirect() || done.has(ref.asIndirect())) return;
        done.add(ref.asIndirect());
        const font = ref.resolve();
        const base = font.get('BaseFont');
        const map = base.isName() ? this.byFont.get(base.asName()) : undefined;
        const toUnicode = font.get('ToUnicode');
        if (!map || !toUnicode.isStream() || font.get('Subtype').asName() !== 'Type0') return;
        const merged = readCMap(toUnicode.readStream().asString());
        let added = 0;
        for (const [gid, str] of map) {
          const have = merged.get(gid);
          if (!have || have === '\ufffd') {
            merged.set(gid, str);
            added++;
          }
        }
        if (added) toUnicode.writeStream(new TextEncoder().encode(cmap(merged)));
      });
    }
  }
}

const utf16hex = (s: string) => [...s].map((c) => {
  const cp = c.codePointAt(0)!;
  const units = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
  return units.map((u) => u.toString(16).padStart(4, '0')).join('');
}).join('');

const hexToString = (hex: string) => {
  const units: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
  return String.fromCharCode(...units);
};

/** Reads the bfchar and bfrange entries of a ToUnicode CMap (the subset MuPDF writes). */
function readCMap(text: string): Map<number, string> {
  const out = new Map<number, string>();
  let section: 'char' | 'range' | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/beginbfchar$/.test(line)) section = 'char';
    else if (/beginbfrange$/.test(line)) section = 'range';
    else if (/^endbf(char|range)$/.test(line)) section = null;
    else if (section === 'char') {
      const m = line.match(/^<([0-9a-f]+)>\s*<([0-9a-f]+)>$/i);
      if (m) out.set(parseInt(m[1], 16), hexToString(m[2]));
    } else if (section === 'range') {
      const m = line.match(/^<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>$/i);
      if (!m) continue; // array-form ranges are not written by MuPDF
      const [lo, hi, first] = [parseInt(m[1], 16), parseInt(m[2], 16), m[3]];
      const base = hexToString(first);
      const last = base.charCodeAt(base.length - 1);
      for (let g = lo; g <= hi; g++) out.set(g, base.slice(0, -1) + String.fromCharCode(last + (g - lo)));
    }
  }
  return out;
}

/** A ToUnicode CMap for 2-byte glyph ids (Identity-H), at most 100 entries per block as the format requires. */
function cmap(map: Map<number, string>): string {
  const entries = [...map].sort((a, b) => a[0] - b[0]).map(([gid, s]) => `<${gid.toString(16).padStart(4, '0')}> <${utf16hex(s)}>`);
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

// ---- Word and text → HTML ------------------------------------------------------------------------

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;

/** Text files: UTF-8 (or UTF-16 with a byte-order mark); anything that is not valid UTF-8 is read as Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes); // drops a UTF-8 BOM
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function textToHtml(bytes: Uint8Array): string {
  // MuPDF shows a tab as one space; four keep indented lines visibly indented.
  const text = decodeText(bytes).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  return page(`<pre class="txt">${escape(text)}</pre>`);
}

type Mammoth = { convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };

/** Word files: mammoth turns the document into plain HTML (structure, not Word's exact look). */
export async function docxToHtml(bytes: ArrayBuffer): Promise<string> {
  // Loaded on first use only, so the app itself stays small.
  const mod = (await import('mammoth/mammoth.browser.min.js')) as unknown as { default?: Mammoth } & Mammoth;
  const mammoth = mod.default ?? mod;
  const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes });
  // MuPDF draws PNG, JPEG and GIF; drop pictures it can't (EMF, WMF, TIFF) rather than fail.
  const body = value.replace(/<img\b[^>]*>/g, (tag) => (/src="data:image\/(png|jpe?g|gif);/i.test(tag) ? tag : ''));
  return page(body);
}
