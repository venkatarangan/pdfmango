// Full (non-subset) embedded fonts -> subsetFonts() -> compare rendering pixel by pixel.
import * as mupdf from 'mupdf';
import fs from 'node:fs';
const fonts = { tamil: ['/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf', 0], cjk: ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 0] };
const samples = { tamil: 'யாதும் ஊரே யாவரும் கேளிர் தமிழ்', cjk: '这是一个测试文件日本語のテキスト한국어' };
const render = (d) => { const p = d.loadPage(0); const x = p.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true); const s = Buffer.from(x.getPixels()); x.destroy(); p.destroy(); return s; };
for (const [k, [file, sub]] of Object.entries(fonts)) {
  if (!fs.existsSync(file)) { console.log(k, 'font missing', file); continue; }
  const font = new mupdf.Font(k, new Uint8Array(fs.readFileSync(file)), sub);
  const doc = new mupdf.PDFDocument();
  const fref = doc.addFont(font); // Identity-H CID font, full font file embedded
  // Glyph ids via encodeCharacter (unshaped, fine for a rendering-equality test); also add an
  // ASCII run so the ToUnicode/width paths are exercised.
  const gids = [...samples[k]].map((c) => font.encodeCharacter(c.codePointAt(0)));
  const hex = gids.map((g) => g.toString(16).padStart(4, '0')).join('');
  const page = doc.addPage([0, 0, 595, 842], 0, { Font: { F: fref } }, `BT /F 28 Tf 40 760 Td <${hex}> Tj ET BT /F 18 Tf 40 700 Td <${hex}${hex}> Tj ET`);
  doc.insertPage(-1, page);
  const full = doc.saveToBuffer('compress').asUint8Array().slice();
  const a = mupdf.Document.openDocument(full, 'application/pdf').asPDF();
  const before = render(a);
  a.subsetFonts();
  const sub_ = a.saveToBuffer('garbage=deduplicate,compress,compress-fonts,objstms').asUint8Array().slice();
  const b = mupdf.Document.openDocument(sub_, 'application/pdf').asPDF();
  const after = render(b);
  console.log(`${k}: full ${(full.length / 1024).toFixed(0)} KB -> subset ${(sub_.length / 1024).toFixed(0)} KB, render ${before.equals(after) ? 'IDENTICAL' : 'DIFFERENT'}`);
  [a, b, doc, font].forEach((x) => x.destroy());
}
