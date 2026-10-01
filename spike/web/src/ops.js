import * as mupdf from 'mupdf';
const A4 = [595.28, 841.89];
export function exifOrientation(b) {
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

export function stripJpegMetadata(b) {
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

export function orientedMatrix(orient, x, y, w, h) {
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

export function addImagePage(doc, bytes, { size = 'A4', margin = 0 } = {}) {
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

export function collectImages(doc, resources, found, seenForms = new Set()) {
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

export function measurePage(page) {
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

export function downsampleImages(doc, { ppi, quality }) {
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
