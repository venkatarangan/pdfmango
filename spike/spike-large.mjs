import * as mupdf from 'mupdf';
import fs from 'node:fs';
import { downsampleImages } from './web/src/ops.js';
const f = process.argv[2];
const LOSSLESS = 'garbage=deduplicate,compress,compress-fonts,compress-images,objstms';
const mb = (n) => (n / 1048576).toFixed(0) + ' MB';
let peak = 0; const tick = () => (peak = Math.max(peak, process.memoryUsage().rss));
const iv = setInterval(tick, 50);
const t0 = performance.now();
let bytes = new Uint8Array(fs.readFileSync(f));
const src = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
bytes = null; // the engine holds its own copy
const n = src.countPages();
const out = new mupdf.PDFDocument(); const map = out.newGraftMap();
for (let i = n - 1; i >= 0; i--) map.graftPage(-1, src, i); // reversed order
const t1 = performance.now();
const level = process.argv[3] ?? 'lossless';
if (level !== 'lossless') downsampleImages(out, { ppi: 150, quality: 75 });
let buf = out.saveToBuffer(LOSSLESS);
const outLen = buf.getLength();
let js = buf.asUint8Array().slice(); buf.destroy(); tick();
const t2 = performance.now();
map.destroy(); out.destroy(); src.destroy();
clearInterval(iv); tick();
console.log(`${level}: ${n} pages, input ${mb(fs.statSync(f).size)} -> ${mb(outLen)}; graft ${(t1 - t0).toFixed(0)} ms, process+save ${(t2 - t1).toFixed(0)} ms; peak RSS ${mb(peak)}`);
