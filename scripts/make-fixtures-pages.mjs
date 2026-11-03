// Test files for Straighten, Straighten photo and Split book spreads. Built from the existing
// fixtures with MuPDF only (no browser), and kept apart from make-fixtures.mjs so the original
// test files, and the regression baseline recorded from them, are never regenerated.
// Usage: npm run fixtures:pages
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('tests/fixtures');
const write = (name, bytes) => {
  fs.writeFileSync(path.join(dir, name), bytes);
  console.log(`${name.padEnd(32)} ${(bytes.length / 1024).toFixed(0).padStart(8)} KB`);
};
const open = (f) => mupdf.Document.openDocument(fs.readFileSync(path.join(dir, f)), 'application/pdf');

/** Clockwise turn (y down) by `deg` about (cx, cy). */
const turn = (deg, cx, cy) => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};

/** Renders page `i` of `doc` at `dpi`, its content turned clockwise by `deg`, onto white of the same size. */
function renderTurned(doc, i, dpi, deg, cs = mupdf.ColorSpace.DeviceGray) {
  const page = doc.loadPage(i);
  const s = dpi / 72;
  const [x0, y0, x1, y1] = page.getBounds();
  const w = Math.round((x1 - x0) * s), h = Math.round((y1 - y0) * s);
  const pix = new mupdf.Pixmap(cs, [0, 0, w, h], false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
  page.run(dev, mupdf.Matrix.concat(mupdf.Matrix.scale(s, s), turn(deg, w / 2, h / 2)));
  dev.close();
  dev.destroy();
  page.destroy();
  return { pix, wPt: x1 - x0, hPt: y1 - y0 };
}

/** One image per page, like a scanner makes. `rotate` sets /Rotate on the page. */
function imagePdf(pages) {
  const doc = new mupdf.PDFDocument();
  for (const { jpeg, w, h, rotate = 0 } of pages) {
    const img = new mupdf.Image(jpeg);
    const ref = doc.addImage(img);
    doc.insertPage(-1, doc.addPage([0, 0, w, h], rotate, { XObject: { Scan: ref } }, `q ${w} 0 0 ${h} 0 0 cm /Scan Do Q`));
    img.destroy();
  }
  const out = doc.saveToBuffer('compress').asUint8Array().slice();
  doc.destroy();
  return out;
}

// ---- Straighten -----------------------------------------------------------------------------------
// Scanned text pages tilted +2°, +5° and -8° (clockwise positive), as greyscale JPEGs at 150 dpi.
const text50 = open('text-50.pdf');
const tilts = [2, 5, -8];
write('tilted-scans.pdf', imagePdf(tilts.map((deg, i) => {
  const { pix, wPt, hPt } = renderTurned(text50, i, 150, deg);
  const jpeg = pix.asJPEG(80, false).slice();
  pix.destroy();
  return { jpeg, w: wPt, h: hPt };
})));

// A page with no text: one of the photos from photo-heavy.pdf, cut out by itself.
{
  const photo = open('photo-heavy.pdf');
  const { pix } = renderTurned(photo, 1, 100, 0, mupdf.ColorSpace.DeviceRGB);
  // The photo sits in the middle of the A4-landscape page (648 x 432 pt); keep just the picture.
  const s = 100 / 72, x = ((841.89 - 648) / 2) * s, y = ((595.28 - 432) / 2 - 10) * s;
  const W = 648 * s, H = 432 * s;
  const cut = pix.warp([[x + 4, y + 4], [x + W - 4, y + 4], [x + W - 4, y + H - 4], [x + 4, y + H - 4]], Math.round(W - 8), Math.round(H - 8));
  write('photo-no-text.pdf', imagePdf([{ jpeg: cut.asJPEG(85, false).slice(), w: 648, h: 432 }]));
  cut.destroy();
  pix.destroy();
  photo.destroy();
}

// A Tamil text page tilted 3°, kept as real (selectable) text: the content is wrapped in a turn.
{
  const src = open('tamil-unicode.pdf').asPDF();
  const doc = new mupdf.PDFDocument();
  doc.graftPage(-1, src, 0);
  const page = doc.loadPage(0);
  const b = page.getBounds();
  const T = page.getTransform();
  page.destroy();
  const R = turn(3, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  const M = mupdf.Matrix.concat(mupdf.Matrix.concat(T, R), mupdf.Matrix.invert(T));
  const pageObj = doc.findPage(0);
  const arr = doc.newArray();
  arr.push(doc.addStream(`q ${M.map((n) => n.toFixed(6)).join(' ')} cm\n`, {}));
  const old = pageObj.get('Contents');
  if (old.isArray()) old.forEach((o) => arr.push(o));
  else arr.push(old);
  arr.push(doc.addStream('\nQ', {}));
  pageObj.put('Contents', arr);
  write('tamil-tilted.pdf', doc.saveToBuffer('compress,garbage').asUint8Array().slice());
  doc.destroy();
  src.destroy();
}

text50.destroy();
