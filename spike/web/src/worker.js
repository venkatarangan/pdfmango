import * as Comlink from 'comlink';
let mupdf, ops, doc;
const LOSSLESS = 'garbage=deduplicate,compress,compress-fonts,compress-images,objstms';

const api = {
  async init() {
    const t = performance.now();
    mupdf = await import('mupdf');
    ops = await import('./ops.js');
    return { loadMs: performance.now() - t };
  },
  open(buf) {
    doc?.destroy();
    doc = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf');
    const n = doc.countPages();
    const pageSizes = [];
    const pdf = doc.asPDF();
    for (let i = 0; i < n; i++) {
      // Page sizes without loading pages: MediaBox via the page tree (approximate; ignores CropBox).
      const mb = pdf.findPage(i).getInheritable('MediaBox');
      pageSizes.push([mb.get(2).asNumber() - mb.get(0).asNumber(), mb.get(3).asNumber() - mb.get(1).asNumber()]);
    }
    return { pageCount: n, pageSizes };
  },
  renderThumb(i, widthPx) {
    const page = doc.loadPage(i);
    const [x0, , x1] = page.getBounds();
    const s = widthPx / (x1 - x0);
    const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, true, true);
    const w = pix.getWidth(), h = pix.getHeight();
    const data = new ImageData(new Uint8ClampedArray(pix.getPixels()), w, h);
    pix.destroy(); page.destroy();
    return createImageBitmap(data).then((bmp) => Comlink.transfer(bmp, [bmp]));
  },
  compress(buf, level) {
    const t0 = performance.now();
    const d = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf').asPDF();
    const lossless = d.saveToBuffer(LOSSLESS).getLength(); // throwaway: just for the safety-net comparison
    d.destroy();
    const d2 = mupdf.Document.openDocument(new Uint8Array(buf), 'application/pdf').asPDF();
    const st = level === 'lossless' ? null : ops.downsampleImages(d2, level === 'balanced' ? { ppi: 150, quality: 75 } : { ppi: 96, quality: 55 });
    const out = d2.saveToBuffer(LOSSLESS);
    const bytes = out.asUint8Array().slice();
    out.destroy(); d2.destroy();
    return Comlink.transfer({ input: buf.byteLength, lossless, output: bytes.length, ms: performance.now() - t0, stats: st, bytes: bytes.buffer }, [bytes.buffer]);
  },
  imagesToPdf(bufs) {
    const d = new mupdf.PDFDocument();
    const info = bufs.map((b) => { const r = ops.addImagePage(d, new Uint8Array(b)); return { orient: r.orient, page: [Math.round(r.pageW), Math.round(r.pageH)] }; });
    const out = d.saveToBuffer(LOSSLESS); const n = out.getLength(); out.destroy(); d.destroy();
    return { info, size: n };
  },
};
Comlink.expose(api);
