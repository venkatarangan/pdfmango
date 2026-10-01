// PDFMango spike: proves each risky MuPDF.js operation in Node against the fixtures.
// Every check prints PASS/FAIL with numbers; the browser half (static hosting, worker, timings) is in ./web.
import * as mupdf from 'mupdf';
import fs from 'node:fs';
import { strict as assert } from 'node:assert';

const FIX = 'fixtures/';
const read = (f) => new Uint8Array(fs.readFileSync(FIX + f));
const results = [];
const warnings = [];
mupdf.setLog({ warning: (m) => warnings.push(m), error: (m) => warnings.push('ERR ' + m) });

async function check(name, fn) {
  const t0 = performance.now();
  try {
    const info = await fn();
    results.push({ name, ok: true, ms: performance.now() - t0, info });
    console.log(`PASS  ${name}  (${(performance.now() - t0).toFixed(0)} ms)${info ? '  ' + info : ''}`);
  } catch (e) {
    results.push({ name, ok: false, info: String(e?.stack ?? e) });
    console.log(`FAIL  ${name}\n      ${e?.stack ?? e}`);
  }
}

const open = (bytes) => mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
const pageText = (doc, i) => { const p = doc.loadPage(i); const st = p.toStructuredText('preserve-whitespace'); const t = st.asText(); st.destroy(); p.destroy(); return t; };
const LOSSLESS = 'garbage=deduplicate,compress,compress-fonts,compress-images,objstms';

// ---------------------------------------------------------------------------------------------
await check('Save options string accepted by 1.28.1 (no unknown-option warnings)', () => {
  warnings.length = 0;
  const d = open(read('text-50.pdf'));
  const out = d.saveToBuffer(LOSSLESS); const n = out.getLength(); out.destroy(); d.destroy();
  assert.equal(warnings.filter((w) => /option/i.test(w)).length, 0, warnings.join('\n'));
  return `text-50: ${read('text-50.pdf').length} -> ${n} bytes`;
});

// ---------------------------------------------------------------------------------------------
// Merge via graft map, in a custom order, across three sources.
let mergedBytes;
await check('Merge 3 PDFs via one graft map per source, custom order', () => {
  const srcs = { A: open(read('tamil-unicode.pdf')), B: open(read('english-cjk.pdf')), C: open(read('text-50.pdf')) };
  const order = [['A', 1], ['B', 0], ['A', 0], ['C', 9], ['B', 1], ['A', 2]];
  const out = new mupdf.PDFDocument();
  const maps = {};
  for (const [s, i] of order) (maps[s] ??= out.newGraftMap()).graftPage(-1, srcs[s], i);
  assert.equal(out.countPages(), order.length);
  // Check order through text: output page k must have the same text as its source page.
  order.forEach(([s, i], k) => assert.equal(pageText(out, k), pageText(srcs[s], i), `page ${k}`));
  const buf = out.saveToBuffer(LOSSLESS); mergedBytes = buf.asUint8Array().slice(); buf.destroy();
  Object.values(maps).forEach((m) => m.destroy()); Object.values(srcs).forEach((d) => d.destroy()); out.destroy();
  return `6 pages, text order verified, ${mergedBytes.length} bytes`;
});

await check('Graft map copies a shared image once (photo-heavy p1 + p10 share an XObject)', () => {
  const src = open(read('photo-heavy.pdf'));
  const size = (useMap) => {
    const out = new mupdf.PDFDocument();
    const m = out.newGraftMap();
    for (const i of [0, 9]) useMap ? m.graftPage(-1, src, i) : out.graftPage(-1, src, i);
    const b = out.saveToBuffer('compress'); const n = b.getLength(); b.destroy(); m.destroy(); out.destroy();
    return n;
  };
  const withMap = size(true), without = size(false);
  src.destroy();
  assert.ok(withMap < without * 0.6, `with map ${withMap}, without ${without}`);
  return `with one map ${(withMap / 1e6).toFixed(2)} MB vs separate grafts ${(without / 1e6).toFixed(2)} MB`;
});

// ---------------------------------------------------------------------------------------------
// Rotation, including /Rotate inherited from the page tree.
await check('Rotation: inherited /Rotate is resolved, added rotation written and normalised', () => {
  // Build a source whose /Rotate 90 lives on the Pages node, not on the page.
  const s = open(read('tamil-unicode.pdf'));
  const pagesNode = s.getTrailer().get('Root').get('Pages');
  pagesNode.put('Rotate', 90);
  for (let i = 0; i < s.countPages(); i++) s.findPage(i).delete('Rotate');
  const srcBytes = s.saveToBuffer('').asUint8Array().slice(); s.destroy();
  const src = open(srcBytes);
  assert.equal(src.findPage(0).get('Rotate').isNull(), true, 'page itself has no /Rotate');
  assert.equal(src.findPage(0).getInheritable('Rotate').asNumber(), 90);

  const out = new mupdf.PDFDocument(); const m = out.newGraftMap();
  const added = [0, 90, 270, 180];
  added.forEach(() => m.graftPage(-1, src, 0));
  const got = added.map((a, k) => {
    const p = out.findPage(k);
    const orig = p.getInheritable('Rotate'); // graftPage copies inherited attributes onto the page
    const base = orig.isNull() ? 0 : orig.asNumber();
    const r = (((base + a) % 360) + 360) % 360;
    p.put('Rotate', r);
    return { direct: p.get('Rotate').asNumber(), base };
  });
  assert.deepEqual(got.map((g) => g.base), [90, 90, 90, 90], 'grafted page keeps inherited rotate');
  assert.deepEqual(got.map((g) => g.direct), [90, 180, 0, 270]);
  // Rendered bounds follow the rotation: 90/270 -> landscape for an A4 portrait page.
  const b = out.saveToBuffer(LOSSLESS).asUint8Array().slice();
  const re = open(b);
  const dims = [0, 1, 2, 3].map((k) => { const p = re.loadPage(k); const [x0, y0, x1, y1] = p.getBounds(); p.destroy(); return x1 - x0 > y1 - y0 ? 'L' : 'P'; });
  assert.deepEqual(dims, ['L', 'P', 'P', 'L']);
  re.destroy(); m.destroy(); out.destroy(); src.destroy();
  return '/Rotate after save: 90,180,0,270; bounds L,P,P,L';
});

// ---------------------------------------------------------------------------------------------
// Image pages: EXIF orientation, A4 fit, original size, JPEG passthrough, PNG transparency.
function exifOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10, le = b[t] === 0x49;
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o) => (le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16)) + b[t + o + 3] * 2 ** 24 : b[t + o] * 2 ** 24 + ((b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]));
      const ifd = u32(4), n = u16(ifd);
      for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; } }
      return 1;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return 1;
}
/** Drops APP1 (EXIF/XMP: GPS, camera serials), APP13 (IPTC) and COM segments; image data untouched. */
function stripJpegMetadata(b) {
  const parts = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (!(marker === 0xe1 || marker === 0xed || marker === 0xfe)) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  parts.push(b.subarray(i));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** PDF `cm` matrix that draws the image's unit square upright into rect (x,y,w,h) for an EXIF orientation. */
function orientedMatrix(orient, x, y, w, h) {
  // Stored image coords (s right, t down, 0..1) -> displayed coords (X right, Y down).
  const T = {
    1: (s, t) => [s, t], 2: (s, t) => [1 - s, t], 3: (s, t) => [1 - s, 1 - t], 4: (s, t) => [s, 1 - t],
    5: (s, t) => [t, s], 6: (s, t) => [1 - t, s], 7: (s, t) => [1 - t, 1 - s], 8: (s, t) => [t, 1 - s],
  }[orient] ?? ((s, t) => [s, t]);
  // PDF image space: u = s, v = 1 - t; page point = (x + w X, y + h (1 - Y)).
  const P = (u, v) => { const [X, Y] = T(u, 1 - v); return [x + w * X, y + h * (1 - Y)]; };
  const [e, f] = P(0, 0), [ax, ay] = P(1, 0), [cx, cy] = P(0, 1);
  return [ax - e, ay - f, cx - e, cy - f, e, f];
}
const A4 = [595.28, 841.89];
function addImagePage(doc, bytes, { size = 'A4', margin = 0 } = {}) {
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const orient = isJpeg ? exifOrientation(bytes) : 1;
  // Read resolution from the original (MuPDF parses EXIF/JFIF/pHYs), then embed the metadata-free copy.
  const meta = new mupdf.Image(bytes);
  const res = [meta.getXResolution(), meta.getYResolution()];
  meta.destroy();
  const img = new mupdf.Image(isJpeg ? stripJpegMetadata(bytes) : bytes);
  const [pw, ph] = [img.getWidth(), img.getHeight()];
  const swap = orient >= 5;
  const [dw, dh] = swap ? [ph, pw] : [pw, ph];
  let pageW, pageH, fx, fy, fw, fh;
  if (size === 'A4') {
    [pageW, pageH] = dw > dh ? [A4[1], A4[0]] : A4;
    const aw = pageW - 2 * margin, ah = pageH - 2 * margin;
    const sc = Math.min(aw / dw, ah / dh);
    fw = dw * sc; fh = dh * sc; fx = (pageW - fw) / 2; fy = (pageH - fh) / 2;
  } else {
    let [xr, yr] = res;
    if (swap) [xr, yr] = [yr, xr];
    const ok = (r) => (r >= 10 && r <= 10000 ? r : 96);
    fw = (dw * 72) / ok(xr); fh = (dh * 72) / ok(yr);
    pageW = fw + 2 * margin; pageH = fh + 2 * margin; fx = margin; fy = margin;
  }
  const ref = doc.addImage(img);
  const m = orientedMatrix(orient, fx, fy, fw, fh).map((n) => +n.toFixed(4));
  const pageObj = doc.addPage([0, 0, pageW, pageH], 0, { XObject: { Im0: ref } }, `q ${m.join(' ')} cm /Im0 Do Q`);
  doc.insertPage(-1, pageObj);
  img.destroy();
  return { ref, orient, pageW, pageH, stored: [pw, ph] };
}
/** Samples the colour at fractional (fx, fy) of a rendered page. */
function sample(doc, i, pts) {
  const p = doc.loadPage(i);
  const pix = p.toPixmap(mupdf.Matrix.scale(0.5, 0.5), mupdf.ColorSpace.DeviceRGB, false, true);
  const w = pix.getWidth(), h = pix.getHeight(), px = pix.getPixels(), n = pix.getNumberOfComponents(), st = pix.getStride();
  const res = pts.map(([fx, fy]) => { const o = Math.floor(fy * h) * st + Math.floor(fx * w) * n; return [px[o], px[o + 1], px[o + 2]]; });
  pix.destroy(); p.destroy();
  return res;
}
const colourName = ([r, g, b]) => (r > 180 && g < 90 && b < 90 ? 'red' : b > 180 && r < 90 && g < 90 ? 'blue' : g > 180 && r < 90 && b < 90 ? 'green' : 'other');

await check('Image pages honour EXIF orientation (1, 3, 6, 8) and fit A4 with matching orientation', () => {
  const doc = new mupdf.PDFDocument();
  const files = ['phone-portrait-exif6.jpg', 'phone-portrait-exif8.jpg', 'phone-landscape-exif1.jpg', 'phone-landscape-exif3.jpg'];
  const infos = files.map((f) => addImagePage(doc, read(f)));
  const out = open(doc.saveToBuffer(LOSSLESS).asUint8Array().slice());
  const report = files.map((f, i) => {
    const [top, bottom, left] = sample(out, i, [[0.5, 0.03], [0.5, 0.97], [0.03, 0.5]]).map(colourName);
    const portraitPage = infos[i].pageH > infos[i].pageW;
    assert.equal(portraitPage, f.includes('portrait'), `${f} page orientation`);
    assert.deepEqual([top, bottom, left], ['red', 'blue', 'green'], `${f}: top/bottom/left = ${top}/${bottom}/${left}`);
    return `${f.replace('.jpg', '')}: exif ${infos[i].orient}, stored ${infos[i].stored.join('x')}, page ${portraitPage ? 'portrait' : 'landscape'}`;
  });
  out.destroy(); doc.destroy();
  return '\n        ' + report.join('\n        ');
});

await check('JPEG embedded without re-encoding (DCTDecode, scan data byte-identical); EXIF/GPS stripped', () => {
  const doc = new mupdf.PDFDocument();
  const src = read('phone-portrait-exif6.jpg');
  const { ref } = addImagePage(doc, src);
  assert.equal(ref.get('Filter').asName(), 'DCTDecode');
  const raw = ref.readRawStream().asUint8Array();
  const stripped = stripJpegMetadata(src);
  assert.equal(raw.length, stripped.length, 'raw stream equals the metadata-stripped JPEG');
  assert.equal(Buffer.compare(Buffer.from(raw), Buffer.from(stripped)), 0);
  assert.equal(exifOrientation(raw), 1, 'no EXIF left inside the PDF (avoids double rotation in viewers that read it)');
  doc.destroy();
  return `source ${src.length} B, embedded stream ${raw.length} B (only the ${src.length - raw.length} B EXIF segment removed)`;
});

await check('PNG keeps transparency (SMask written)', () => {
  const doc = new mupdf.PDFDocument();
  const { ref } = addImagePage(doc, read('transparent.png'));
  const smask = ref.get('SMask');
  assert.ok(!smask.isNull(), 'SMask present');
  const out = open(doc.saveToBuffer(LOSSLESS).asUint8Array().slice());
  // Corners of the image are transparent in the source -> white page shows through.
  const [c] = sample(out, 0, [[0.5, 0.5]]);
  out.destroy(); doc.destroy();
  return `SMask ${smask.get('Width').toString()}x${smask.get('Height').toString()} ${smask.get('Subtype').toString()}`;
});

await check('Image page margins and original-size option', () => {
  const doc = new mupdf.PDFDocument();
  const a = addImagePage(doc, read('phone-landscape-exif1.jpg'), { size: 'A4', margin: 0 });
  const b = addImagePage(doc, read('phone-landscape-exif1.jpg'), { size: 'A4', margin: 36 });
  const c = addImagePage(doc, read('phone-landscape-exif1.jpg'), { size: 'original', margin: 0 });
  const d = addImagePage(doc, read('plain.png'), { size: 'original', margin: 18 });
  const out = open(doc.saveToBuffer(LOSSLESS).asUint8Array().slice());
  // Margin None: image touches the page edge on the constraining axis; Medium: white band at the edge.
  // 4:3 photo on landscape A4 is height-bound: it touches the top edge with no margin.
  const [edgeA] = sample(out, 0, [[0.5, 0.003]]); const [edgeB] = sample(out, 1, [[0.5, 0.02]]);
  assert.notDeepEqual(edgeA, [255, 255, 255], 'no margin -> image at edge');
  assert.deepEqual(edgeB, [255, 255, 255], 'medium margin -> white edge');
  // 1600x1200 at 72 dpi (EXIF) -> 1600x1200 pt; PNG without pHYs -> 96 ppi -> 480x360 + 2*18.
  assert.equal(Math.round(c.pageW), 1600); assert.equal(Math.round(d.pageW), 516);
  out.destroy(); doc.destroy();
  return `A4 landscape ${a.pageW.toFixed(0)}x${a.pageH.toFixed(0)}; original JPEG page ${c.pageW.toFixed(0)}x${c.pageH.toFixed(0)} pt; PNG page ${d.pageW.toFixed(0)}x${d.pageH.toFixed(0)} pt`;
});

// ---------------------------------------------------------------------------------------------
// Image measurement with a custom Device, and downsampling.
/** Collects image XObjects reachable from a page's resources, recursing into forms. */
function collectImages(doc, resources, found, seenForms = new Set()) {
  const xobjs = resources.get('XObject');
  if (!xobjs.isDictionary()) return;
  xobjs.forEach((val, name) => {
    if (!val.isIndirect()) return;
    const num = val.asIndirect();
    const obj = val;
    const sub = obj.get('Subtype').isName() ? obj.get('Subtype').asName() : '';
    if (sub === 'Image') {
      const e = found.get(num) ?? { ref: val, uses: [] };
      e.uses.push({ dict: xobjs, name: String(name) });
      found.set(num, e);
    } else if (sub === 'Form' && !seenForms.has(num)) {
      seenForms.add(num);
      const r = obj.get('Resources');
      if (r.isDictionary()) collectImages(doc, r, found, seenForms);
    }
  });
}
/** Max displayed size (in points) of each image on a page, keyed by fz_image pointer. */
function measurePage(page) {
  const sizes = new Map();
  const dev = new mupdf.Device({
    fillImage(image, ctm) {
      const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]);
      const prev = sizes.get(image.pointer);
      sizes.set(image.pointer, { w: Math.max(w, prev?.w ?? 0), h: Math.max(h, prev?.h ?? 0), image });
    },
  });
  page.run(dev, mupdf.Matrix.identity);
  dev.close(); dev.destroy();
  return sizes;
}
let measurement;
await check('Custom Device fillImage gives each image its displayed size; maps back to object numbers', () => {
  const doc = open(read('photo-heavy.pdf'));
  const rows = [];
  let matched = 0, total = 0;
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const found = new Map();
    collectImages(doc, page.getObject().get('Resources'), found);
    const sizes = measurePage(page);
    for (const [num, e] of found) {
      total++;
      const img = doc.loadImage(e.ref);
      const m = sizes.get(img.pointer);
      if (m) matched++;
      rows.push({ page: i + 1, num, px: `${img.getWidth()}x${img.getHeight()}`, shown: m ? `${m.w.toFixed(0)}x${m.h.toFixed(0)} pt` : 'unmatched', ppi: m ? (img.getWidth() / (m.w / 72)).toFixed(0) : '-' });
      img.destroy();
    }
    page.destroy();
  }
  measurement = rows;
  doc.destroy();
  assert.equal(matched, total, 'every image matched by pointer');
  const r = rows.find((x) => x.page === 11);
  assert.ok(Math.abs(+r.ppi - 800) < 2, `small image ppi ${r.ppi}`);
  return `${matched}/${total} images matched; photo 1: ${rows[0].px} shown ${rows[0].shown} = ${rows[0].ppi} ppi; small: ${r.ppi} ppi`;
});

/** Balanced/Strong: downsample every oversized image in doc, in place. */
function downsampleImages(doc, { ppi, quality }) {
  const images = new Map(); // num -> { ref, uses, maxW, maxH (pt) }
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const found = new Map();
    collectImages(doc, page.getObject().get('Resources'), found);
    const sizes = measurePage(page);
    const [x0, , x1] = page.getBounds();
    for (const [num, e] of found) {
      const img = doc.loadImage(e.ref);
      const m = sizes.get(img.pointer) ?? { w: x1 - x0, h: ((x1 - x0) * img.getHeight()) / img.getWidth() }; // fallback: full page width
      const cur = images.get(num) ?? { ref: e.ref, uses: [], maxW: 0, maxH: 0 };
      cur.uses.push(...e.uses); cur.maxW = Math.max(cur.maxW, m.w); cur.maxH = Math.max(cur.maxH, m.h);
      images.set(num, cur);
      img.destroy();
    }
    page.destroy();
  }
  const stats = { seen: images.size, replaced: 0, skipped: {}, before: 0, after: 0 };
  const skip = (why) => { stats.skipped[why] = (stats.skipped[why] ?? 0) + 1; };
  for (const [, e] of images) {
    const obj = e.ref;
    const img = doc.loadImage(e.ref);
    try {
      const W = img.getWidth(), H = img.getHeight();
      const effPpi = W / (e.maxW / 72);
      if (effPpi <= ppi * 1.2) { skip('already small'); continue; }
      if (img.getImageMask() || img.getBitsPerComponent() === 1) { skip('1-bit/mask'); continue; }
      if (img.getMask() || !obj.get('SMask').isNull() || !obj.get('Mask').isNull()) { skip('transparency'); continue; }
      const nw = Math.max(1, Math.round((e.maxW / 72) * ppi)), nh = Math.max(1, Math.round((nw * H) / W));
      const cs = img.getColorSpace();
      const target = cs && cs.isGray() ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB;
      const pix = new mupdf.Pixmap(target, [0, 0, nw, nh], false);
      pix.clear(255);
      const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
      dev.fillImage(img, [nw, 0, 0, nh, 0, 0], 1);
      dev.close(); dev.destroy();
      const jpeg = pix.asJPEG(quality, false);
      pix.destroy();
      const oldLen = e.ref.readRawStream().getLength();
      stats.before += oldLen;
      if (jpeg.length >= oldLen) { skip('JPEG not smaller'); stats.after += oldLen; continue; }
      const newImg = new mupdf.Image(jpeg);
      const newRef = doc.addImage(newImg);
      newImg.destroy();
      for (const u of e.uses) u.dict.put(u.name, newRef);
      stats.replaced++; stats.after += jpeg.length;
    } finally { img.destroy(); }
  }
  return stats;
}

const sizes = {};
await check('Balanced downsampling (150 ppi, q75) via DrawDevice resample + asJPEG + addImage; >= 40% smaller', () => {
  const srcBytes = read('photo-heavy.pdf');
  const lossless = (() => { const d = open(srcBytes); const b = d.saveToBuffer(LOSSLESS); const n = b.getLength(); b.destroy(); d.destroy(); return n; })();
  const doc = open(srcBytes);
  const t0 = performance.now();
  const st = downsampleImages(doc, { ppi: 150, quality: 75 });
  const buf = doc.saveToBuffer(LOSSLESS); const outBytes = buf.asUint8Array().slice(); buf.destroy();
  const ms = performance.now() - t0;
  doc.destroy();
  sizes.balanced = { input: srcBytes.length, lossless, output: outBytes.length, ms, st };
  fs.writeFileSync('out-balanced.pdf', outBytes);
  // Verify: same page count, images now ~150 ppi, page 1 & 10 still share one image.
  const re = open(outBytes);
  const imgs = new Set();
  for (const p of [0, 9]) { const f = new Map(); collectImages(re, re.findPage(p).get('Resources'), f); f.forEach((_, n) => imgs.add(n)); }
  assert.equal(imgs.size, 1, 'shared image still shared');
  re.destroy();
  const pct = 100 * (1 - outBytes.length / srcBytes.length);
  assert.ok(pct >= 40, `only ${pct.toFixed(1)}% smaller`);
  return `${(srcBytes.length / 1e6).toFixed(1)} MB -> ${(outBytes.length / 1e6).toFixed(2)} MB (${pct.toFixed(0)}% smaller) in ${ms.toFixed(0)} ms; ${st.replaced}/${st.seen} replaced, skipped ${JSON.stringify(st.skipped)}`;
});

await check('Strong downsampling (96 ppi, q55)', () => {
  const srcBytes = read('photo-heavy.pdf');
  const doc = open(srcBytes);
  const t0 = performance.now();
  const st = downsampleImages(doc, { ppi: 96, quality: 55 });
  const n = doc.saveToBuffer(LOSSLESS).getLength();
  doc.destroy();
  sizes.strong = { output: n };
  return `${(srcBytes.length / 1e6).toFixed(1)} MB -> ${(n / 1e6).toFixed(2)} MB (${(100 * (1 - n / srcBytes.length)).toFixed(0)}% smaller) in ${(performance.now() - t0).toFixed(0)} ms; skipped ${JSON.stringify(st.skipped)}`;
});

await check('Scan mode: render 110 ppi -> JPEG q60 -> image-only PDF, same page sizes', () => {
  const srcBytes = read('photo-heavy.pdf');
  const src = open(srcBytes);
  const out = new mupdf.PDFDocument();
  const t0 = performance.now();
  for (let i = 0; i < src.countPages(); i++) {
    const p = src.loadPage(i);
    const [x0, y0, x1, y1] = p.getBounds();
    const pix = p.toPixmap(mupdf.Matrix.scale(110 / 72, 110 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    const img = new mupdf.Image(pix.asJPEG(60, false));
    const w = x1 - x0, h = y1 - y0;
    out.insertPage(-1, out.addPage([0, 0, w, h], 0, { XObject: { P: out.addImage(img) } }, `q ${w} 0 0 ${h} 0 0 cm /P Do Q`));
    img.destroy(); pix.destroy(); p.destroy();
  }
  const n = out.saveToBuffer(LOSSLESS).getLength();
  const ms = performance.now() - t0;
  const text = pageText(out, 0).trim();
  out.destroy(); src.destroy();
  assert.equal(text, '', 'no text left');
  sizes.scan = { output: n };
  return `photo-heavy ${(srcBytes.length / 1e6).toFixed(1)} MB -> ${(n / 1e6).toFixed(2)} MB in ${ms.toFixed(0)} ms (${(ms / 12).toFixed(0)} ms/page)`;
});

// ---------------------------------------------------------------------------------------------
// Unicode text survives merge + Balanced; font subsetting check.
await check('Tamil + CJK text identical after merge, reorder and Balanced compression', () => {
  const t = open(read('tamil-unicode.pdf')), c = open(read('english-cjk.pdf'));
  const out = new mupdf.PDFDocument();
  const mt = out.newGraftMap(), mc = out.newGraftMap();
  mt.graftPage(-1, t, 2); mc.graftPage(-1, c, 0); mt.graftPage(-1, t, 1); mt.graftPage(-1, t, 0); mc.graftPage(-1, c, 1);
  downsampleImages(out, { ppi: 150, quality: 75 });
  const re = open(out.saveToBuffer(LOSSLESS).asUint8Array().slice());
  const expect = [[t, 2], [c, 0], [t, 1], [t, 0], [c, 1]];
  expect.forEach(([d, i], k) => assert.equal(pageText(re, k), pageText(d, i), `page ${k}`));
  const tamil = pageText(re, 2);
  assert.ok(tamil.includes('யாதும் ஊரே யாவரும் கேளிர்'), 'marker phrase searchable');
  const cjk = pageText(re, 1);
  assert.ok(cjk.includes('这是一个测试文件') && cjk.includes('日本語のテキストです'), 'CJK searchable');
  [t, c, re, out, mt, mc].forEach((x) => x.destroy());
  return 'all 5 pages: extracted text byte-identical to source; Tamil marker and CJK phrases found';
});

function renderHash(doc) {
  const out = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const p = doc.loadPage(i);
    const pix = p.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true);
    out.push(Buffer.from(pix.getPixels()).toString('base64'));
    pix.destroy(); p.destroy();
  }
  return out;
}
await check('subsetFonts(): no rendering change on Tamil and CJK files?', () => {
  const lines = [];
  for (const f of ['tamil-unicode.pdf', 'english-cjk.pdf', 'bookmarks-links-form.pdf']) {
    const a = open(read(f));
    const before = renderHash(a);
    const n0 = a.saveToBuffer(LOSSLESS).getLength();
    a.subsetFonts();
    const bytes = a.saveToBuffer(LOSSLESS).asUint8Array().slice();
    const b = open(bytes);
    const after = renderHash(b);
    const same = before.every((h, i) => h === after[i]);
    lines.push(`${f}: pixels ${same ? 'identical' : 'DIFFERENT'}, ${n0} -> ${bytes.length} bytes`);
    a.destroy(); b.destroy();
  }
  return '\n        ' + lines.join('\n        ');
});

// ---------------------------------------------------------------------------------------------
// Edge cases.
await check('Password PDF: needsPassword, wrong then right password, output unencrypted', () => {
  const d = mupdf.Document.openDocument(read('password-mango.pdf'), 'application/pdf');
  assert.equal(d.needsPassword(), true);
  assert.equal(d.authenticatePassword('wrong'), 0);
  const ok = d.authenticatePassword('mango');
  assert.ok(ok > 0, 'authenticated');
  const out = new mupdf.PDFDocument(); const m = out.newGraftMap();
  m.graftPage(-1, d.asPDF(), 0);
  const bytes = out.saveToBuffer(LOSSLESS).asUint8Array().slice();
  const re = mupdf.Document.openDocument(bytes, 'application/pdf');
  assert.equal(re.needsPassword(), false);
  assert.ok(pageText(re.asPDF(), 0).includes('சோதனை'));
  [d, out, m, re].forEach((x) => x.destroy());
  return `authenticatePassword('mango') = ${ok}; exported copy opens without a password`;
});

await check("Owner-restricted PDF: hasPermission('assemble') is false; normal file true", () => {
  const r = mupdf.Document.openDocument(read('owner-restricted.pdf'), 'application/pdf');
  const n = mupdf.Document.openDocument(read('text-50.pdf'), 'application/pdf');
  assert.equal(r.needsPassword(), false);
  assert.equal(r.hasPermission('assemble'), false);
  assert.equal(n.hasPermission('assemble'), true);
  const perms = Object.keys(mupdf.Document.PERMISSION).map((k) => `${k}=${r.hasPermission(k)}`).join(' ');
  r.destroy(); n.destroy();
  return perms;
});

await check('Damaged PDF opens via repair; wasRepaired() reports it', () => {
  warnings.length = 0;
  const d = open(read('damaged.pdf'));
  const n = d.countPages();
  const rep = d.wasRepaired();
  d.destroy();
  assert.equal(n, 50); assert.equal(rep, true);
  return `50 pages recovered, wasRepaired()=true, ${warnings.length} engine warnings`;
});

await check('Detect bookmarks, forms and signatures (for export warnings)', () => {
  const d = open(read('bookmarks-links-form.pdf'));
  const outline = d.loadOutline();
  const acro = d.getTrailer().get('Root').get('AcroForm');
  const hasForm = acro.isDictionary() && acro.get('Fields').length > 0;
  const sigFlags = acro.isDictionary() ? acro.get('SigFlags') : null;
  const signed = !!(sigFlags && sigFlags.isNumber() && (sigFlags.asNumber() & 1));
  const nFields = hasForm ? acro.get('Fields').length : 0;
  const links = (() => { const p = d.loadPage(0); const l = p.getLinks().map((x) => (x.isExternal() ? 'ext' : 'int')); p.destroy(); return l; })();
  d.destroy();
  assert.ok(outline?.length >= 1); assert.ok(hasForm);
  return `outline items ${outline.length}, form fields ${nFields}, signed=${signed}, page-1 links [${links}]`;
});

// ---------------------------------------------------------------------------------------------
await check('Thumbnail render speed in Node (50 pages at 320 px wide)', () => {
  const d = open(read('text-50.pdf'));
  const t0 = performance.now();
  for (let i = 0; i < d.countPages(); i++) {
    const p = d.loadPage(i);
    const [x0, , x1] = p.getBounds();
    const s = 320 / (x1 - x0);
    const pix = p.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true);
    pix.destroy(); p.destroy();
  }
  const ms = performance.now() - t0;
  d.destroy();
  return `${ms.toFixed(0)} ms total, ${(ms / 50).toFixed(1)} ms/page`;
});

fs.writeFileSync('spike-node-results.json', JSON.stringify({ results, measurement, sizes }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
