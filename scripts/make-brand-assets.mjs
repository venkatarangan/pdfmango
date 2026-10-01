// Generates favicon, Apple touch icon, PWA icons and the 1200x630 social preview from
// public/brand/mangoidiots-logo.png. Run with `npm run brand` after changing the logo.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const logo = fs.readFileSync(path.join(root, 'public/brand/mangoidiots-logo.png')).toString('base64');
const logoUrl = `data:image/png;base64,${logo}`;
const iconsDir = path.join(root, 'public/icons');
fs.mkdirSync(iconsDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

/** Draws the logo onto a white square of `size`, with `pad` (fraction of size) around it. */
async function icon(size, pad) {
  const b64 = await page.evaluate(async ({ logoUrl, size, pad }) => {
    const img = new Image();
    img.src = logoUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const inner = size * (1 - 2 * pad);
    g.drawImage(img, size * pad, size * pad, inner, inner);
    return c.toDataURL('image/png').split(',')[1];
  }, { logoUrl, size, pad });
  return Buffer.from(b64, 'base64');
}

const out = (rel, buf) => {
  fs.writeFileSync(path.join(root, rel), buf);
  console.log(`${rel.padEnd(36)} ${(buf.length / 1024).toFixed(1)} KB`);
};
out('public/favicon.png', await icon(48, 0));
out('public/icons/apple-touch-icon.png', await icon(180, 0.06));
out('public/icons/icon-192.png', await icon(192, 0));
out('public/icons/icon-512.png', await icon(512, 0));
// Maskable icons must keep the artwork inside the central 80% safe zone.
out('public/icons/icon-maskable-512.png', await icon(512, 0.14));

// Social preview, 1200 x 630.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><html><head><style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{font-family:system-ui,"Segoe UI",Roboto,"Noto Sans",sans-serif;background:#fff;color:#1C1B1F;display:flex;align-items:center}
  .bar{position:absolute;left:0;top:0;bottom:0;width:24px;background:#FFA41B}
  .wrap{display:flex;align-items:center;gap:56px;padding:0 96px 0 120px}
  img{width:300px;height:300px;flex:none}
  h1{font-size:104px;line-height:1;margin:0 0 28px;letter-spacing:-2px}
  p{font-size:38px;line-height:1.3;margin:0;color:#5F6368;max-width:640px}
  .url{margin-top:30px;font-size:30px;color:#9A5B00;font-weight:600}
</style></head><body><div class="bar"></div><div class="wrap">
  <img src="${logoUrl}" alt="">
  <div><h1>PDFMango</h1><p>Merge, reorder, rotate and compress PDFs. Your files never leave your device.</p><div class="url">pdf.mangoidiots.com</div></div>
</div></body></html>`);
await page.evaluate(() => document.fonts.ready);
out('public/social-preview.png', await page.screenshot({ type: 'png' }));

await browser.close();
