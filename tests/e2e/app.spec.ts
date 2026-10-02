import { expect, test, type Download, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const fx = (f: string) => path.resolve(import.meta.dirname, '../fixtures', f);
const cards = (page: Page) => page.locator('.card');

async function addFiles(page: Page, files: string[], expectedCards: number) {
  await page.setInputFiles('input[type=file]', files.map(fx));
  await expect(cards(page)).toHaveCount(expectedCards, { timeout: 30_000 });
}

async function openOutput(download: Download) {
  const bytes = readFileSync(await download.path());
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF()!;
  const text = (i: number) => {
    const p = doc.loadPage(i);
    const st = p.toStructuredText('preserve-whitespace');
    const t = st.asText();
    st.destroy();
    p.destroy();
    return t;
  };
  const rotate = (i: number) => {
    const r = doc.findPage(i).getInheritable('Rotate');
    return r.isNumber() ? r.asNumber() : 0;
  };
  return { doc, count: doc.countPages(), text, rotate, size: bytes.length };
}

async function download(page: Page, setup?: () => Promise<void>) {
  await page.locator('.toolbar .btn-filled, .bottombar .download').locator('visible=true').click();
  await expect(page.getByRole('dialog', { name: 'Download PDF' })).toBeVisible();
  await setup?.();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('dialog[open] button[type=submit]').click()]);
  await expect(page.getByRole('dialog', { name: 'Download PDF' })).toBeHidden({ timeout: 30_000 });
  return dl;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('opens straight into the drop zone, with no CSP violations @phone', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => /Content Security Policy|Refused to/i.test(m.text()) && violations.push(m.text()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Drop PDFs or images here' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(page.locator('footer.footer')).toContainText(/PDFMango v\d+\.\d+\.\d+/);
  await addFiles(page, ['tamil-unicode.pdf'], 3);
  await expect(page.locator('.card canvas.loaded')).toHaveCount(3);
  expect(violations).toEqual([]);
});

test('merge, reorder, rotate, delete, download: output has the right pages, order and /Rotate', async ({ page }) => {
  await page.goto('/');
  await addFiles(page, ['tamil-unicode.pdf', 'english-cjk.pdf', 'bookmarks-links-form.pdf', 'phone-portrait-exif6.jpg', 'phone-landscape-exif3.jpg'], 10);
  await expect(page.locator('.tag').first()).toHaveText('tamil-unicode.pdf');

  // Select page 2 and rotate it right; rotate page 1 left from its own hover actions.
  await cards(page).nth(1).locator('.hit').click();
  await page.getByRole('button', { name: 'Rotate selected right' }).first().click();
  await cards(page).nth(0).hover();
  await page.getByRole('button', { name: 'Rotate page 1 left' }).click();

  // Keyboard reorder: move page 4 (english-cjk p1) to the front with Alt+ArrowLeft x3.
  await page.getByRole('button', { name: 'Clear selection' }).or(page.getByRole('button', { name: 'Select all' })).first().isVisible();
  await cards(page).nth(1).locator('.hit').click(); // deselect page 2
  await cards(page).nth(3).locator('.hit').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowLeft');
  await expect(cards(page).nth(0).locator('.tag')).toHaveText('english-cjk.pdf');

  // Delete the last page (landscape photo).
  await cards(page).nth(9).hover();
  await page.getByRole('button', { name: 'Delete page 10' }).click();
  await expect(cards(page)).toHaveCount(9);

  const out = await openOutput(await download(page));
  expect(out.count).toBe(9);
  expect(out.text(0)).toContain('English and CJK test');
  expect(out.text(1)).toContain('அகர முதல'); // tamil p1
  expect(out.text(2)).toContain('புறநானூறு'); // tamil p2
  expect(out.text(3)).toContain('பாரதியார்'); // tamil p3
  expect([0, 1, 2, 3].map(out.rotate)).toEqual([0, 270, 90, 0]);
  expect(out.text(6)).toContain('Chapter 2'); // bookmarks file page 2
  out.doc.destroy();
  await expect(page.locator('.snack')).toContainText('→');
});

test('undo and redo walk through edits', async ({ page }) => {
  await page.goto('/');
  await addFiles(page, ['tamil-unicode.pdf'], 3);
  await cards(page).nth(0).hover();
  await page.getByRole('button', { name: 'Delete page 1' }).click();
  await expect(cards(page)).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(cards(page)).toHaveCount(3);
  await page.keyboard.press('Control+Shift+z');
  await expect(cards(page)).toHaveCount(2);
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await page.getByRole('button', { name: /^Undo/ }).first().click(); // undoes adding the file
  await expect(page.getByText('No pages left.')).toBeVisible();
});

test('images: default A4 with no margin; Medium margin and original size from the dialog', async ({ page }) => {
  await page.goto('/');
  await addFiles(page, ['phone-portrait-exif6.jpg', 'phone-landscape-exif1.jpg'], 2);
  const sizes = (o: Awaited<ReturnType<typeof openOutput>>) =>
    [0, 1].map((i) => {
      const p = o.doc.loadPage(i);
      const [x0, y0, x1, y1] = p.getBounds();
      p.destroy();
      return [Math.round(x1 - x0), Math.round(y1 - y0)];
    });
  let out = await openOutput(await download(page));
  expect(sizes(out)).toEqual([[595, 842], [842, 595]]);
  out.doc.destroy();
  out = await openOutput(
    await download(page, async () => {
      await page.getByText('Original image size').click();
      await page.getByText('Medium', { exact: true }).click();
    }),
  );
  expect(sizes(out)).toEqual([[1200 + 72, 1600 + 72], [1600 + 72, 1200 + 72]]);
  out.doc.destroy();
});

test('Balanced compression shrinks the photo-heavy PDF by at least 40%', async ({ page }) => {
  await page.goto('/');
  await addFiles(page, ['photo-heavy.pdf'], 12);
  const input = readFileSync(fx('photo-heavy.pdf')).length;
  const out = await openOutput(await download(page, () => page.getByText('Balanced', { exact: true }).click()));
  expect(out.count).toBe(12);
  expect(out.size).toBeLessThan(input * 0.6);
  out.doc.destroy();
  await expect(page.locator('.snack')).toContainText('% smaller');
});

test('password-protected PDF: wrong password, then the right one', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fx('password-mango.pdf'));
  const dlg = page.getByRole('dialog', { name: 'Password needed' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Password').fill('wrong');
  await dlg.getByRole('button', { name: 'Open' }).click();
  await expect(dlg.getByRole('alert')).toContainText('not right');
  await dlg.getByLabel('Password').fill('mango');
  await dlg.getByRole('button', { name: 'Open' }).click();
  await expect(cards(page)).toHaveCount(3);
  await page.locator('.toolbar .btn-filled').click();
  await expect(page.getByRole('dialog', { name: 'Download PDF' }).getByText('The downloaded copy will not be password-protected.')).toBeVisible();
});

test('refuses owner-restricted PDFs, HEIC/WebP and other files with one-line messages', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fx('owner-restricted.pdf'));
  await expect(page.locator('.snack')).toContainText('restricted page changes');
  await page.locator('.snack').getByRole('button', { name: 'Dismiss' }).click();
  await page.setInputFiles('input[type=file]', { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('\0\0\0\x18ftypheic\0\0\0\0mif1heic') });
  await expect(page.locator('.snack')).toContainText('convert to JPG or PNG first');
  await page.locator('.snack').getByRole('button', { name: 'Dismiss' }).click();
  await page.setInputFiles('input[type=file]', { name: 'notes.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\x03\x04 not a pdf') });
  await expect(page.locator('.snack')).toContainText('opens PDF, JPG and PNG files');
});

test('a damaged PDF opens with the repaired notice', async ({ page }) => {
  await page.goto('/');
  await addFiles(page, ['damaged.pdf'], 50);
  await expect(page.locator('.snack')).toContainText('had errors and was repaired');
});

test('keyboard only: choose, select, move, rotate and download', async ({ page }) => {
  await page.goto('/');
  // The file picker itself is OS UI; the button that opens it must be reachable by keyboard.
  await page.keyboard.press('Tab'); // brand link
  await page.keyboard.press('Tab'); // About
  await page.keyboard.press('Tab'); // Source code
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeFocused();
  await addFiles(page, ['tamil-unicode.pdf'], 3);

  await page.getByRole('button', { name: /^Page 1:/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /^Page 2:/ })).toBeFocused();
  await page.keyboard.press('Space'); // select page 2
  await page.keyboard.press('Alt+ArrowRight'); // move it to position 3
  await expect(cards(page).nth(2)).toHaveClass(/selected/);
  await page.keyboard.press('Tab'); // its Rotate left action
  await page.keyboard.press('Tab'); // Rotate right
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+o').catch(() => {}); // must not throw; picker opens in a real browser
  const out = await openOutput(await download(page));
  expect(out.text(2)).toContain('புறநானூறு');
  expect(out.rotate(2)).toBe(90);
  out.doc.destroy();
});

test('Start over clears everything after a confirm @phone', async ({ page }) => {
  await page.goto('/');
  await addFiles(page, ['tamil-unicode.pdf'], 3);
  const startOver = page.locator('.toolbar').getByRole('button', { name: 'Start over' });
  if (await startOver.isVisible()) await startOver.click();
  else {
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Start over' }).click();
  }
  await page.getByRole('dialog', { name: 'Start over?' }).getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByRole('heading', { name: 'Drop PDFs or images here' })).toBeVisible();
});

test('no request ever carries file data; only same-origin requests on localhost', async ({ page }) => {
  const requests: { url: string; method: string; body: number }[] = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postDataBuffer()?.length ?? 0 }));
  await page.goto('/');
  await addFiles(page, ['tamil-unicode.pdf', 'phone-portrait-exif6.jpg'], 4);
  await download(page);
  const foreign = requests.filter((r) => !r.url.startsWith('http://localhost:4180/') && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  expect(foreign).toEqual([]);
  expect(requests.filter((r) => r.method !== 'GET' || r.body > 0)).toEqual([]);
  // The app itself writes nothing to storage.
  const stored = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookies: document.cookie }));
  expect(stored).toEqual({ local: 0, session: 0, cookies: '' });
});

test('About page carries the required texts', async ({ page }) => {
  await page.goto('/about/');
  await expect(page.getByRole('heading', { name: 'Why PDFMango' })).toBeVisible();
  await expect(page.getByText('PDFMango uses Google Analytics to count anonymous visits')).toBeVisible();
  await expect(page.getByText('provided as is, without warranty of any kind')).toBeVisible();
  await expect(page.getByRole('link', { name: 'MuPDF.js' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Built with AI' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Claude Opus 5.5');
  await expect(page.locator('img.hero')).toBeVisible();
});

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    // Wait until the precache is complete and the worker controls the page.
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    return reg.active?.state;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Drop PDFs or images here' })).toBeVisible();
  await addFiles(page, ['tamil-unicode.pdf'], 3); // the WASM engine comes from the cache too
  await expect(page.locator('.card canvas.loaded')).toHaveCount(3);
  await page.goto('/about/');
  await expect(page.getByRole('heading', { name: 'Why PDFMango' })).toBeVisible();
});

test('1,000 pages load and scroll; page 1,001 is refused with the limit', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await addFiles(page, Array(5).fill('text-200.pdf'), 1000);
  await page.setInputFiles('input[type=file]', fx('plain.png'));
  await expect(page.locator('.snack')).toContainText('up to 1,000 pages');
  await expect(cards(page)).toHaveCount(1000);
  // Scroll to the end: the last thumbnails render on demand.
  await cards(page).nth(999).scrollIntoViewIfNeeded();
  await expect(cards(page).nth(999).locator('canvas.loaded')).toBeVisible({ timeout: 30_000 });
  const out = await openOutput(await download(page));
  expect(out.count).toBe(1000);
  out.doc.destroy();
});

// Runs only after `npm run fixtures:large` (the 250 MB file is never committed).
const large = fx('large/large-250mb.pdf');
test('a ~250 MB PDF loads and exports on desktop Chrome', async ({ page }) => {
  test.skip(!existsSync(large), 'run npm run fixtures:large first');
  test.setTimeout(300_000);
  await page.goto('/');
  await page.setInputFiles('input[type=file]', large);
  await expect(cards(page)).not.toHaveCount(0, { timeout: 120_000 });
  const n = await cards(page).count();
  const out = await openOutput(await download(page));
  expect(out.count).toBe(n);
  out.doc.destroy();
});
