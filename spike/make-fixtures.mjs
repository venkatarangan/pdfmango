// Generates the PDFMango test corpus into ./fixtures (or the dir given as argv[2]).
// Text PDFs are printed by Chromium (real embedded font subsets, like most PDFs in the wild);
// images are drawn on a canvas; MuPDF adds encryption, a form field and damage.
// Usage: node make-fixtures.mjs [outDir] [--large]
import { chromium } from '@playwright/test';
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'fixtures');
const wantLarge = process.argv.includes('--large');
fs.mkdirSync(outDir, { recursive: true });
const write = (name, bytes) => {
  fs.writeFileSync(path.join(outDir, name), bytes);
  console.log(`${name.padEnd(32)} ${(bytes.length / 1024).toFixed(0).padStart(8)} KB`);
};

const browser = await chromium.launch();
const page = await browser.newPage();

async function printHtml(html, opts = {}) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' }, ...opts });
}

const css = `body{font:12pt/1.6 "Noto Sans","Noto Sans Tamil",sans-serif;color:#222} h1,h2{color:#9A5B00} .pb{break-after:page}`;

// ---- Tamil Unicode text, embedded fonts ---------------------------------------------------------
// Public-domain classical verses (Thirukkural, Purananuru, Bharathiyar) plus plain test sentences.
const TAMIL_MARKER = 'யாதும் ஊரே யாவரும் கேளிர்';
const tamilPages = [
  `<h1>தமிழ் சோதனை ஆவணம் — பக்கம் 1</h1>
   <p>இது ஒரு சோதனை ஆவணம். இதில் உள்ள எழுத்துகள் தேர்ந்தெடுக்கக்கூடியதாகவும் தேடக்கூடியதாகவும் இருக்க வேண்டும்.</p>
   <h2>திருக்குறள்</h2>
   <p>அகர முதல எழுத்தெல்லாம் ஆதி<br>பகவன் முதற்றே உலகு</p>
   <p>கற்றதனால் ஆய பயனென்கொல் வாலறிவன்<br>நற்றாள் தொழாஅர் எனின்</p>`,
  `<h1>பக்கம் 2 — புறநானூறு</h1>
   <p>${TAMIL_MARKER}</p>
   <p>தீதும் நன்றும் பிறர்தர வாரா</p>
   <p>English mixed in: PDFMango keeps Tamil text selectable after merge and compression.</p>`,
  `<h1>பக்கம் 3 — பாரதியார்</h1>
   <p>யாமறிந்த மொழிகளிலே தமிழ்மொழி போல் இனிதாவது எங்கும் காணோம்</p>
   <p>மூன்றாம் பக்கம். பக்கங்களை மாற்றி அடுக்கிய பிறகும் இந்த வரி சரியாக இருக்க வேண்டும்.</p>`,
];
write('tamil-unicode.pdf', await printHtml(
  `<html lang="ta"><style>${css}</style><body>${tamilPages.map((p, i) => `<section class="${i < tamilPages.length - 1 ? 'pb' : ''}">${p}</section>`).join('')}</body></html>`));

// ---- English + CJK ------------------------------------------------------------------------------
write('english-cjk.pdf', await printHtml(`<html><style>${css} .cjk{font-family:"Noto Sans CJK SC","Noto Sans CJK JP",sans-serif}</style><body>
  <section class="pb"><h1>English and CJK test</h1><p>The quick brown fox jumps over the lazy dog.</p>
  <p class="cjk">这是一个测试文件。所有文字都应该可以选择和搜索。</p>
  <p class="cjk">日本語のテキストです。ページを並べ替えても文字は残ります。</p>
  <p class="cjk">한국어 텍스트도 포함되어 있습니다.</p></section>
  <section><h1>Page 2</h1><p class="cjk">第二页：合并和压缩之后，文字仍然可以复制。</p></section></body></html>`));

// ---- N-page text-only PDFs ----------------------------------------------------------------------
const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ';
function textDoc(n) {
  let body = '';
  for (let i = 1; i <= n; i++) {
    body += `<section class="${i < n ? 'pb' : ''}"><h1>Page ${i} of ${n}</h1>${`<p>${LOREM.repeat(2)}</p>`.repeat(3)}</section>`;
  }
  return `<html><style>${css} h1{font-size:40pt}</style><body>${body}</body></html>`;
}
write('text-50.pdf', await printHtml(textDoc(50)));
write('text-200.pdf', await printHtml(textDoc(200)));

// ---- Bookmarks, internal links, external link (+ a form field added below with MuPDF) -----------
const linkedPdf = await printHtml(`<html><style>${css}</style><body>
  <section class="pb"><h1 id="c1">Chapter 1</h1><p>Jump to <a href="#c3">Chapter 3</a>. Visit <a href="https://example.com/">example.com</a>.</p></section>
  <section class="pb"><h1 id="c2">Chapter 2</h1><p>Back to <a href="#c1">Chapter 1</a>.</p></section>
  <section><h1 id="c3">Chapter 3</h1><p>Name: (form field to the right)</p></section></body></html>`, { outline: true, tagged: true });
{
  const doc = mupdf.Document.openDocument(linkedPdf, 'application/pdf').asPDF();
  // Hand-build an AcroForm with one text field on page 3.
  const pageObj = doc.findPage(2);
  const field = doc.addObject({
    Type: doc.newName('Annot'), Subtype: doc.newName('Widget'), FT: doc.newName('Tx'),
    T: doc.newString('name'), V: doc.newString('Venkat'), Rect: [300, 700, 500, 724], F: 4,
    DA: doc.newString('/Helv 12 Tf 0 g'), P: pageObj,
  });
  let annots = pageObj.get('Annots');
  if (annots.isNull()) { annots = doc.newArray(); pageObj.put('Annots', annots); }
  annots.push(field);
  const helv = doc.addObject({ Type: doc.newName('Font'), Subtype: doc.newName('Type1'), BaseFont: doc.newName('Helvetica'), Encoding: doc.newName('WinAnsiEncoding') });
  const acroForm = doc.addObject({ Fields: [field], NeedAppearances: true, DA: doc.newString('/Helv 12 Tf 0 g'), DR: { Font: { Helv: helv } } });
  doc.getTrailer().get('Root').put('AcroForm', acroForm);
  write('bookmarks-links-form.pdf', doc.saveToBuffer('compress').asUint8Array());
  doc.destroy();
}

// ---- Canvas images ------------------------------------------------------------------------------
await page.setContent('<html><body></body></html>');
/** Draws a photo-like picture (gradients, shapes, noise) and returns JPEG/PNG bytes. */
async function canvasImage({ w, h, seed, type = 'image/jpeg', quality = 0.92, upright = false, orient = 1, transparent = false }) {
  const b64 = await page.evaluate(({ w, h, seed, type, quality, upright, orient, transparent }) => {
    let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    // Draw the *upright* scene into a canvas of display size.
    const dw = w, dh = h;
    const c = document.createElement('canvas'); c.width = dw; c.height = dh;
    const g = c.getContext('2d');
    if (!transparent) {
      const grad = g.createLinearGradient(0, 0, dw, dh);
      grad.addColorStop(0, `hsl(${rnd() * 360},70%,60%)`); grad.addColorStop(1, `hsl(${rnd() * 360},70%,35%)`);
      g.fillStyle = grad; g.fillRect(0, 0, dw, dh);
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `hsla(${rnd() * 360},80%,${30 + rnd() * 50}%,${transparent ? 0.8 : 0.5})`;
      g.beginPath(); g.arc(rnd() * dw, rnd() * dh, rnd() * dw / 6, 0, Math.PI * 2); g.fill();
    }
    if (!transparent) { // fine noise so JPEG behaves like a camera photo
      const img = g.getImageData(0, 0, dw, dh); const d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 40; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      g.putImageData(img, 0, 0);
    }
    if (upright) { // orientation markers: red band on top, blue band at bottom, green on the left, "TOP" text
      g.fillStyle = '#f00'; g.fillRect(0, 0, dw, dh * 0.15);
      g.fillStyle = '#00f'; g.fillRect(0, dh * 0.85, dw, dh * 0.15);
      g.fillStyle = '#0f0'; g.fillRect(0, dh * 0.15, dw * 0.1, dh * 0.7);
      g.fillStyle = '#000'; g.font = `bold ${Math.round(dh / 10)}px sans-serif`; g.textAlign = 'center'; g.fillText('TOP', dw / 2, dh * 0.4);
    }
    // Store pixels as a camera would: apply the inverse of the EXIF orientation.
    let out = c;
    if (orient !== 1) {
      const swap = orient >= 5;
      out = document.createElement('canvas'); out.width = swap ? dh : dw; out.height = swap ? dw : dh;
      const o = out.getContext('2d');
      // stored = inverse(orient)(display). For 3: rotate 180. For 6 (display = stored rotated 90 CW): stored = display rotated 90 CCW. For 8: stored = display rotated 90 CW.
      if (orient === 3) { o.translate(dw, dh); o.rotate(Math.PI); }
      if (orient === 6) { o.translate(0, dw); o.rotate(-Math.PI / 2); }
      if (orient === 8) { o.translate(dh, 0); o.rotate(Math.PI / 2); }
      o.drawImage(c, 0, 0);
    }
    return out.toDataURL(type, quality).split(',')[1];
  }, { w, h, seed, type, quality, upright, orient, transparent });
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Replaces the JFIF APP0 segment with an EXIF APP1 carrying Orientation and 72 dpi, like a phone camera. */
function withExif(jpeg, orientation) {
  const be16 = (n) => [(n >> 8) & 255, n & 255];
  const be32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  // TIFF header (big-endian) + IFD0 with Orientation, XResolution, YResolution, ResolutionUnit.
  const entries = 4, ifdStart = 8, ifdSize = 2 + entries * 12 + 4, ratOff = ifdStart + ifdSize;
  const tiff = [0x4d, 0x4d, 0, 42, ...be32(8), ...be16(entries),
    ...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientation), 0, 0,
    ...be16(0x011a), ...be16(5), ...be32(1), ...be32(ratOff),
    ...be16(0x011b), ...be16(5), ...be32(1), ...be32(ratOff + 8),
    ...be16(0x0128), ...be16(3), ...be32(1), ...be16(2), 0, 0,
    ...be32(0),
    ...be32(72), ...be32(1), ...be32(72), ...be32(1)];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app1 = [0xff, 0xe1, ...be16(payload.length + 2), ...payload];
  let i = 2; // skip SOI
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) i = 4 + ((jpeg[4] << 8) | jpeg[5]); // drop APP0
  return new Uint8Array([0xff, 0xd8, ...app1, ...jpeg.subarray(i)]);
}

// Phone photos. Display sizes are what the viewer should see after honouring EXIF.
write('phone-portrait-exif6.jpg', withExif(await canvasImage({ w: 1200, h: 1600, seed: 1, upright: true, orient: 6 }), 6));
write('phone-portrait-exif8.jpg', withExif(await canvasImage({ w: 1200, h: 1600, seed: 2, upright: true, orient: 8 }), 8));
write('phone-landscape-exif1.jpg', withExif(await canvasImage({ w: 1600, h: 1200, seed: 3, upright: true, orient: 1 }), 1));
write('phone-landscape-exif3.jpg', withExif(await canvasImage({ w: 1600, h: 1200, seed: 4, upright: true, orient: 3 }), 3));
write('transparent.png', await canvasImage({ w: 800, h: 600, seed: 5, type: 'image/png', transparent: true }));
write('plain.png', await canvasImage({ w: 640, h: 480, seed: 6, type: 'image/png' }));

// ---- Photo-heavy PDF (~20 MB) -------------------------------------------------------------------
// Large camera-like JPEGs placed at ~9 x 6 in (≈ 330+ ppi), one image shared by two pages,
// one small image, and one PNG with a soft mask (must be left alone by downsampling).
{
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'));
  const addPhotoPage = (imgRef, caption, placeW, placeH) => {
    const [pw, ph] = [841.89, 595.28]; // A4 landscape
    const x = (pw - placeW) / 2, y = (ph - placeH) / 2 + 10;
    const contents = `q ${placeW} 0 0 ${placeH} ${x} ${y} cm /Im0 Do Q BT /F1 12 Tf ${x} 30 Td (${caption}) Tj ET`;
    const pageObj = doc.addPage([0, 0, pw, ph], 0, { XObject: { Im0: imgRef }, Font: { F1: font } }, contents);
    doc.insertPage(-1, pageObj);
  };
  let shared = null;
  for (let i = 0; i < 9; i++) {
    const jpg = await canvasImage({ w: 3000, h: 2000, seed: 100 + i, quality: 0.9 });
    const img = new mupdf.Image(jpg);
    const ref = doc.addImage(img);
    img.destroy();
    if (i === 0) shared = ref;
    addPhotoPage(ref, `Photo ${i + 1} (3000 x 2000 px at 648 x 432 pt)`, 648, 432);
  }
  addPhotoPage(shared, 'Photo 1 again (same image object, shared)', 648, 432);
  const small = new mupdf.Image(await canvasImage({ w: 1200, h: 800, seed: 200, quality: 0.95 }));
  addPhotoPage(doc.addImage(small), 'Small image: 1200 x 800 px shown at 1.5 x 1 in (800 ppi)', 108, 72);
  small.destroy();
  const png = new mupdf.Image(await canvasImage({ w: 1500, h: 1000, seed: 300, type: 'image/png', transparent: true }));
  addPhotoPage(doc.addImage(png), 'Transparent PNG (soft mask; must be skipped)', 648, 432);
  png.destroy();
  write('photo-heavy.pdf', doc.saveToBuffer('compress').asUint8Array());
  doc.destroy();
}

// ---- Scanned PDF: pages of text-50 rendered to greyscale JPEGs ----------------------------------
{
  const src = mupdf.Document.openDocument(fs.readFileSync(path.join(outDir, 'text-50.pdf')), 'application/pdf');
  const doc = new mupdf.PDFDocument();
  for (let i = 0; i < 6; i++) {
    const p = src.loadPage(i);
    const [x0, y0, x1, y1] = p.getBounds();
    const pix = p.toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceGray, false, true);
    const img = new mupdf.Image(pix.asJPEG(80, false));
    const ref = doc.addImage(img);
    const w = x1 - x0, h = y1 - y0;
    doc.insertPage(-1, doc.addPage([0, 0, w, h], 0, { XObject: { Scan: ref } }, `q ${w} 0 0 ${h} 0 0 cm /Scan Do Q`));
    img.destroy(); pix.destroy(); p.destroy();
  }
  write('scanned.pdf', doc.saveToBuffer('compress').asUint8Array());
  doc.destroy(); src.destroy();
}

// ---- Encrypted: password to open; owner-restricted (no page assembly) ---------------------------
{
  const small = fs.readFileSync(path.join(outDir, 'tamil-unicode.pdf'));
  const enc = (opts) => {
    const d = mupdf.Document.openDocument(small, 'application/pdf').asPDF();
    const out = d.saveToBuffer(opts).asUint8Array();
    d.destroy();
    return out;
  };
  // Permission bits (PDF 32000 Table 22): print=4, modify=8, copy=16, annotate=32, form=256, accessibility=512, assemble=1024, print-hq=2048.
  write('password-mango.pdf', enc('encrypt=aes-256,user-password=mango,owner-password=owner-secret,permissions=-1'));
  const noAssemble = (4 | 16 | 32 | 256 | 512 | 2048) | ~0xfff; // everything except modify + assemble
  write('owner-restricted.pdf', enc(`encrypt=aes-256,owner-password=owner-secret,permissions=${noAssemble}`));
}

// ---- Damaged: valid objects, but the xref table and startxref point at garbage -----------------
{
  const src = fs.readFileSync(path.join(outDir, 'text-50.pdf'));
  const d = mupdf.Document.openDocument(src, 'application/pdf').asPDF();
  const bytes = Buffer.from(d.saveToBuffer('').asUint8Array()); // classic xref table, no object streams
  d.destroy();
  const text = bytes.toString('latin1');
  const sx = text.lastIndexOf('startxref');
  const damaged = Buffer.concat([bytes.subarray(0, sx), Buffer.from('startxref\n999999999\n%%EOF\n', 'latin1')]);
  const xi = damaged.indexOf('\nxref\n');
  if (xi > 0) damaged.write('\nxXXf\n', xi, 'latin1'); // break the table keyword too
  write('damaged.pdf', damaged);
}

// ---- Optional: ~250 MB PDF for the desktop size limit (never committed) -------------------------
if (wantLarge) {
  const doc = new mupdf.PDFDocument();
  let total = 0, i = 0;
  while (total < 250 * 1024 * 1024) {
    const jpg = await canvasImage({ w: 4000, h: 3000, seed: 1000 + i, quality: 1 });
    total += jpg.length;
    const img = new mupdf.Image(jpg);
    const ref = doc.addImage(img); img.destroy();
    doc.insertPage(-1, doc.addPage([0, 0, 842, 595], 0, { XObject: { I: ref } }, `q 842 0 0 595 0 0 cm /I Do Q`));
    i++;
  }
  write('large-250mb.pdf', doc.saveToBuffer('').asUint8Array());
  doc.destroy();
}

await browser.close();
