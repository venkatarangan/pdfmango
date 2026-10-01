// Drives the built static spike (web/dist) in Chromium and records timings and CSP violations.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: 'web', stdio: 'pipe' });
await new Promise((r) => server.stdout.on('data', (d) => /4173/.test(d) && r()));
const URL_ = 'http://localhost:4173/';
const out = {};
const browser = await chromium.launch();
try {
  for (const throttle of [1, 4]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    let wasmType;
    page.on('response', (r) => r.url().endsWith('.wasm') && (wasmType = r.headers()['content-type']));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const key = `cpu${throttle}x`;
    out[key] = {};
    for (const visit of ['cold', 'warm']) {
      await page.goto(URL_);
      const fcp = await page.evaluate(() => new Promise((r) => new PerformanceObserver((l) => r(l.getEntries()[0]?.startTime)).observe({ type: 'paint', buffered: true })));
      const ready = await page.evaluate(() => window.spike.ready);
      const engineReady = await page.evaluate(() => performance.now());
      out[key][visit] = { fcpMs: Math.round(fcp), engineInitMs: Math.round(ready.initMs), engineReadyAtMs: Math.round(engineReady) };
    }
    out[key].wasmContentType = wasmType;
    out[key].text50 = await page.evaluate(() => window.spike.run('text-50.pdf'));
    out[key].text200 = await page.evaluate(() => window.spike.run('text-200.pdf'));
    out[key].tamil = await page.evaluate(() => window.spike.run('tamil-unicode.pdf'));
    const strip = ({ bytes, ...r }) => r;
    out[key].balanced = strip(await page.evaluate(() => window.spike.compress('photo-heavy.pdf', 'balanced').then(({ bytes, ...r }) => r)));
    out[key].strong = await page.evaluate(() => window.spike.compress('photo-heavy.pdf', 'strong').then(({ bytes, ...r }) => r));
    out[key].images = await page.evaluate(() => window.spike.imagesToPdf(['phone-portrait-exif6.jpg', 'phone-landscape-exif3.jpg', 'transparent.png']));
    out[key].cspViolations = await page.evaluate(() => window.spike.csp);
    out[key].consoleErrors = consoleErrors;
    if (throttle === 1) await page.screenshot({ path: 'spike-grid.png' });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
fs.writeFileSync('spike-browser-results.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
