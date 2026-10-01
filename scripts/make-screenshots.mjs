// Takes the README screenshots (desktop and phone) from a production build, using test fixtures only.
// Usage: npm run build && npm run screenshots   [-- --out <dir>]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(root, 'docs/screenshots');
const fx = (f) => path.join(root, 'tests/fixtures', f);

const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
await new Promise((r) => server.stdout.on('data', (d) => /4174/.test(d) && r()));
const browser = await chromium.launch();
try {
  for (const [name, opts] of [
    ['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
    ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
  ]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(m.text()));
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto('http://localhost:4174/');
    await page.screenshot({ path: path.join(out, `${name}-empty.png`) });

    await page.setInputFiles('input[type=file]', [
      fx('tamil-unicode.pdf'), fx('english-cjk.pdf'), fx('phone-portrait-exif6.jpg'), fx('phone-landscape-exif3.jpg'), fx('text-50.pdf'),
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 57, null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.card canvas.loaded').length >= 6, null, { timeout: 30000 });
    await page.locator('.card').nth(1).locator('.hit').click();
    await page.locator('.card').nth(4).locator('.hit').click();
    if (name === 'desktop') await page.getByRole('button', { name: 'Rotate selected right' }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `${name}-grid.png`) });

    await page.locator('.toolbar .btn-filled, .bottombar .download').locator('visible=true').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `${name}-download.png`) });
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('dialog[open] button[type=submit]').click()]);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, `${name}-done.png`) });
    console.log(`${name}: downloaded ${download.suggestedFilename()}; console problems: ${problems.length ? problems.join(' | ') : 'none'}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
