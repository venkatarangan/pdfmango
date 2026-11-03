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

    // ---- The page tools (0.4.0), each from a fresh start ----
    const fresh = async (files, cards) => {
      const c = await browser.newContext(opts);
      const p = await c.newPage();
      p.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(m.text()));
      p.on('pageerror', (e) => problems.push(String(e)));
      await p.goto('http://localhost:4174/');
      await p.setInputFiles('input[type=file]', files.map(fx));
      await p.waitForFunction((n) => document.querySelectorAll('.card').length === n, cards, { timeout: 30000 });
      await p.waitForFunction(() => document.querySelectorAll('.card canvas.loaded').length >= 1, null, { timeout: 30000 });
      return { c, p };
    };
    const openPage = async (p, i) => {
      await p.locator('.card .hit').nth(i).dblclick();
      await p.locator('dialog.preview canvas').waitFor();
      await p.waitForTimeout(900);
    };
    const pageTools = async (p) => {
      await p.getByRole('button', { name: name === 'desktop' ? 'Page tools' : 'More actions' }).click();
    };

    // Straighten: a tilted scan in the page preview, straightened, with the tools under it.
    {
      const { c, p } = await fresh(['tilted-scans.pdf'], 3);
      await openPage(p, 1);
      await p.locator('dialog.preview').getByRole('button', { name: 'Straighten', exact: true }).click();
      await p.locator('dialog.preview p[role=status]').waitFor();
      await p.waitForTimeout(900);
      await p.screenshot({ path: path.join(out, `${name}-straighten.png`) });
      await c.close();
    }
    // Split book spreads: a scanned book after the split, with one page marked Check split.
    {
      const { c, p } = await fresh(['book-20.pdf'], 20);
      await pageTools(p);
      await p.getByRole('menuitem', { name: 'Split book spreads…' }).locator('visible=true').click();
      await p.locator('dialog[open]').getByRole('button', { name: 'Split', exact: true }).click();
      await p.waitForFunction(() => document.querySelectorAll('.card').length === 37, null, { timeout: 60000 });
      // Scroll to the spread that needs a check, so its badge shows.
      await p.locator('.card .review').first().scrollIntoViewIfNeeded();
      await p.evaluate(() => window.scrollBy(0, -120));
      await p.waitForTimeout(1500);
      await p.screenshot({ path: path.join(out, `${name}-split.png`) });
      await c.close();
    }
    // Straighten photo: the corners placed on the sheet by PDFMango.
    {
      const { c, p } = await fresh(['photo-of-sheet.jpg'], 1);
      await openPage(p, 0);
      await p.locator('dialog.preview').getByRole('button', { name: 'Straighten photo' }).click();
      await p.locator('dialog.photo-editor .found').filter({ hasText: 'Corners placed' }).waitFor({ timeout: 20000 });
      await p.locator('dialog.photo-editor canvas.ready').waitFor();
      await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(out, `${name}-straighten-photo.png`) });
      await c.close();
    }
    // Crop: Auto on a page photographed on a chair.
    {
      const { c, p } = await fresh(['spread-photo-fold.jpg'], 1);
      await openPage(p, 0);
      await p.locator('dialog.preview').getByRole('button', { name: 'Crop' }).click();
      await p.locator('dialog.crop-editor canvas.ready').waitFor({ timeout: 20000 });
      await p.locator('dialog.crop-editor').getByRole('button', { name: 'Auto' }).click();
      await p.locator('dialog.crop-editor p.note[role=status]').waitFor();
      await p.waitForTimeout(400);
      await p.screenshot({ path: path.join(out, `${name}-crop.png`) });
      await c.close();
    }
    console.log(`${name}: page tools shots taken; console problems: ${problems.length ? problems.join(' | ') : 'none'}`);
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
