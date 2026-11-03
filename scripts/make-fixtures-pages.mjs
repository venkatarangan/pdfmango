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

// ---- Straighten photo -------------------------------------------------------------------------------
// A phone photo of one printed sheet, shot at an angle, lying on a darker table. The sheet's corners
// sit at SHEET (pixels, top-left, top-right, bottom-right, bottom-left); the tests use them.
export const SHEET = [[372, 148], [1262, 236], [1338, 1092], [246, 1010]];

/** Solves the 8 x 8 system for the homography taking each `from` point to its `to` point. */
function homography(from, to) {
  const A = [], bv = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bv.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bv.push(v);
  }
  for (let c = 0; c < 8; c++) { // Gaussian elimination with partial pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [bv[c], bv[p]] = [bv[p], bv[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      bv[r] -= f * bv[c];
    }
  }
  const h = bv.map((v, i) => v / A[i][i]);
  return (x, y) => { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
}

{
  const page = text50.loadPage(4);
  const sheet = page.toPixmap(mupdf.Matrix.scale(150 / 72, 150 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
  page.destroy();
  const [sw, sh] = [sheet.getWidth(), sheet.getHeight()];
  const src = sheet.getPixels();
  const W = 1600, H = 1200;
  const photo = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, W, H], false);
  const out = photo.getPixels();
  const toSheet = homography(SHEET, [[0, 0], [sw, 0], [sw, sh], [0, sh]]);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const [u, v] = toSheet(x + 0.5, y + 0.5);
      if (u >= 0 && v >= 0 && u < sw - 1 && v < sh - 1) {
        // Bilinear sample of the sheet, a little warm and dim, like paper under a lamp.
        const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
        for (let c = 0; c < 3; c++) {
          const at = (xx, yy) => src[(yy * sw + xx) * 3 + c];
          const val = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
          out[o + c] = Math.max(0, Math.min(255, val * [0.94, 0.9, 0.82][c] + (rnd() - 0.5) * 10));
        }
      } else {
        const n = (rnd() - 0.5) * 24; // wooden table
        out[o] = 96 + n; out[o + 1] = 66 + n; out[o + 2] = 44 + n;
      }
    }
  }
  write('photo-of-sheet.jpg', photo.asJPEG(88, false).slice());
  photo.destroy();
  sheet.destroy();
}

// ---- Split book spreads -----------------------------------------------------------------------------
// Two facing pages scanned as one landscape image. The true spine position of every spread (as a
// share of the width, as the page shows) goes into spreads.json for the tests.
const truth = {};
const DPI = 80;

/** One text-50 page as greyscale pixels. */
function grayPage(i) {
  const page = text50.loadPage(i);
  const pix = page.toPixmap(mupdf.Matrix.scale(DPI / 72, DPI / 72), mupdf.ColorSpace.DeviceGray, false, true);
  page.destroy();
  const out = { w: pix.getWidth(), h: pix.getHeight(), px: new Uint8Array(pix.getPixels()) };
  pix.destroy();
  return out;
}

/**
 * Two pages side by side. `gutter`: 'shadow' (dark spine), 'gap' (white strip) or 'weak' (inner
 * margins cut away, no shadow: the spine barely shows). `trim` shifts the spine by cutting the
 * left page's outer edge. Returns grey pixels and the spine position.
 */
function spread(li, ri, { gutter = 'shadow', trim = 0 } = {}) {
  const L = grayPage(li), R = grayPage(ri);
  const inner = gutter === 'weak' ? Math.round(L.w * 0.1) : 0; // cut the inner margins away
  const gap = gutter === 'gap' ? 24 : 0;
  const lw = L.w - trim - inner, rw = R.w - inner;
  const w = lw + gap + rw, h = L.h;
  const px = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < lw; x++) px[y * w + x] = L.px[y * L.w + x + trim];
    for (let x = 0; x < rw; x++) px[y * w + lw + gap + x] = R.px[y * R.w + x + inner];
  }
  const spine = lw + gap / 2;
  if (gutter === 'shadow') {
    const sigma = w * 0.012;
    for (let x = 0; x < w; x++) {
      const k = 1 - 0.6 * Math.exp(-(((x - spine) / sigma) ** 2));
      if (k > 0.995) continue;
      for (let y = 0; y < h; y++) px[y * w + x] = Math.round(px[y * w + x] * k);
    }
  }
  return { w, h, px, at: spine / w };
}

function grayJpeg({ w, h, px }, quality = 75) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, w, h], false);
  pix.getPixels().set(px);
  const jpeg = pix.asJPEG(quality, false).slice();
  pix.destroy();
  return jpeg;
}

/** The same pixels turned a quarter clockwise (stored that way, shown upright by /Rotate 90). */
function turnedLeft({ w, h, px }) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(w - 1 - x) * h + y] = px[y * w + x];
  return { w: h, h: w, px: out };
}

const pt = (n) => (n * 72) / DPI;
const spreadPdf = (name, items) => {
  write(name, imagePdf(items.map((it) => ({ jpeg: grayJpeg(it.img), w: pt(it.img.w), h: pt(it.img.h), rotate: it.rotate ?? 0 }))));
  truth[name] = items.map((it) => it.at ?? null);
};

{
  const dark = spread(6, 7);
  spreadPdf('spread-scan.pdf', [{ img: dark, at: dark.at }]);
  const gap = spread(8, 9, { gutter: 'gap', trim: 30 });
  spreadPdf('spread-white-gap.pdf', [{ img: gap, at: gap.at }]);
  // Stored sideways and shown upright by /Rotate 90, as some scanners do.
  const side = spread(10, 11, { trim: 50 });
  spreadPdf('spread-rotate90.pdf', [{ img: turnedLeft(side), rotate: 90, at: side.at }]);
  write('spread.jpg', grayJpeg(dark, 85));
  truth['spread.jpg'] = [dark.at];
}

// A 20-page book: cover, spreads with a dark spine, a single page, spreads with a white gap, one
// spread whose spine barely shows, one more spread, and a back cover.
{
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const single = (i) => {
    const g = grayPage(i);
    return { img: g, at: null };
  };
  const cover = grayPage(12);
  for (let y = Math.round(cover.h * 0.45); y < cover.h * 0.85; y++) for (let x = Math.round(cover.w * 0.15); x < cover.w * 0.85; x++) cover.px[y * cover.w + x] = 70 + Math.round(rnd() * 60);
  const items = [{ img: cover, at: null }];
  let n = 13;
  const add = (gutter) => {
    const s = spread(n, n + 1, { gutter, trim: Math.round(rnd() * 60) });
    n += 2;
    items.push({ img: s, at: s.at });
  };
  for (let i = 0; i < 8; i++) add('shadow');
  items.push(single(n++));
  for (let i = 0; i < 7; i++) add('gap');
  add('weak');
  add('shadow');
  items.push(single(n++));
  spreadPdf('book-20.pdf', items);
}

// A phone photo of an open book: colour, on a table, turned 2.5° so the spine slants.
{
  const s = spread(2, 3);
  const W = Math.round(s.w * 1.12), H = Math.round(s.h * 1.16);
  const photo = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, W, H], false);
  const out = photo.getPixels();
  const t = (2.5 * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  const [cx, cy] = [W / 2, H / 2];
  let seed = 5;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Back from the photo to the spread: turn by -2.5° about the centre.
      const dx = x - cx, dy = y - cy;
      const u = Math.round(c * dx + sn * dy + s.w / 2), v = Math.round(-sn * dx + c * dy + s.h / 2);
      const o = (y * W + x) * 3;
      const n = (rnd() - 0.5) * 14;
      if (u >= 0 && v >= 0 && u < s.w && v < s.h) {
        const g = s.px[v * s.w + u];
        out[o] = Math.min(255, g * 0.97 + n); out[o + 1] = Math.min(255, g * 0.93 + n); out[o + 2] = Math.min(255, g * 0.85 + n);
      } else { out[o] = 80 + n; out[o + 1] = 58 + n; out[o + 2] = 40 + n; }
    }
  }
  write('spread-photo-slanted.jpg', photo.asJPEG(85, false).slice());
  photo.destroy();
  truth['spread-photo-slanted.jpg'] = [(s.w * 0.06 + s.at * s.w) / W]; // roughly; the spine slants
}

// Real text on both halves of a spread (so the split halves can be checked for selectable text):
// page 1 is a plain landscape spread; page 2 is the same spread stored sideways with /Rotate 90.
{
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'));
  const [W, H] = [1190, 842]; // two A4 pages side by side, in points
  const half = (x0, title, word) => {
    let t = `BT /F1 28 Tf ${x0 + 60} ${H - 110} Td (${title}) Tj ET\n`;
    for (let i = 0; i < 14; i++) t += `BT /F1 13 Tf ${x0 + 60} ${H - 170 - i * 22} Td (${word} line ${i + 1} of the ${word.toLowerCase()} page.) Tj ET\n`;
    return t;
  };
  // Drawn on a landscape page (y up); a soft grey band marks the fold.
  const spreadOps = `0.8 g ${W / 2 - 6} 0 12 ${H} re f 0 g\n${half(0, 'LEFT PAGE', 'Left')}${half(W / 2, 'RIGHT PAGE', 'Right')}`;
  doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, { Font: { F1: font } }, spreadOps));
  // Stored portrait (H wide, W tall); /Rotate 90 turns it clockwise to show the landscape spread.
  doc.insertPage(-1, doc.addPage([0, 0, H, W], 90, { Font: { F1: font } }, `q 0 1 -1 0 ${H} 0 cm\n${spreadOps}Q`));
  write('spread-text.pdf', doc.saveToBuffer('compress').asUint8Array().slice());
  doc.destroy();
  truth['spread-text.pdf'] = [0.5, 0.5];
}

fs.writeFileSync(path.join(dir, 'spreads.json'), JSON.stringify(truth, null, 1) + '\n');
console.log('spreads.json');

text50.destroy();
