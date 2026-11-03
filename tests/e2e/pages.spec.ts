// Straighten, fine rotation, Straighten photo and Split book spreads, end to end.
import { expect, test, type Download, type Page } from '@playwright/test';
import * as mupdf from 'mupdf';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fx = (f: string) => path.resolve(import.meta.dirname, '../fixtures', f);
const cards = (page: Page) => page.locator('.card');
const words = (t: string) => t.replace(/\s+/g, ' ').trim();

async function addFiles(page: Page, files: string[], expectedCards: number) {
  await page.setInputFiles('input[type=file]', files.map(fx));
  await expect(cards(page)).toHaveCount(expectedCards, { timeout: 30_000 });
}

function textOf(bytes: Uint8Array, i: number) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const p = doc.loadPage(i);
  const st = p.toStructuredText('preserve-whitespace');
  const t = st.asText();
  st.destroy();
  p.destroy();
  doc.destroy();
  return t;
}

async function saveAll(page: Page): Promise<Uint8Array> {
  await page.locator('.toolbar .btn-filled, .bottombar .download').locator('visible=true').click();
  await expect(page.getByRole('dialog', { name: 'Your PDF' })).toBeVisible();
  const [dl]: [Download, unknown] = await Promise.all([page.waitForEvent('download'), page.locator('dialog[open] button[type=submit]').click()]);
  return new Uint8Array(readFileSync(await dl.path()));
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto('/');
});

test('Straighten fixes tilted scans and a tilted Tamil page; text stays selectable and identical', async ({ page }) => {
  await addFiles(page, ['tilted-scans.pdf', 'tamil-tilted.pdf', 'photo-no-text.pdf'], 5);
  await page.getByRole('button', { name: 'Page tools' }).click();
  await page.getByRole('menuitem', { name: 'Straighten all' }).click();
  await expect(page.locator('.snack')).toContainText('Straightened 4 pages. 1 page left as it was');

  const out = await saveAll(page);
  const doc = mupdf.Document.openDocument(out, 'application/pdf');
  expect(doc.countPages()).toBe(5);
  doc.destroy();
  const original = new Uint8Array(readFileSync(fx('tamil-unicode.pdf')));
  expect(words(textOf(out, 3))).toBe(words(textOf(original, 0)));
});

test('Straighten from the page preview says what it did; undo puts the tilt back', async ({ page }) => {
  await addFiles(page, ['tilted-scans.pdf'], 3);
  await cards(page).nth(1).locator('.hit').dblclick();
  const preview = page.locator('dialog.preview');
  await preview.getByRole('button', { name: 'Straighten' }).click();
  await expect(preview.locator('p[role=status]')).toHaveText('Straightened by 5°.');
  await preview.getByRole('button', { name: 'Straighten' }).click();
  await expect(preview.locator('p[role=status]')).toHaveText('Straightened by 5°.'); // measured afresh, same answer
  await preview.getByRole('button', { name: 'Close preview' }).click();
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Page tools' }).click();
  await page.getByRole('menuitem', { name: 'Straighten all' }).click();
  await expect(page.locator('.snack')).toContainText('Straightened 3 pages.');
});

test('fine-rotate slider turns the page at export; Reset and undo take it back', async ({ page }) => {
  await addFiles(page, ['tilted-scans.pdf'], 3);
  await cards(page).nth(1).locator('.hit').dblclick();
  const preview = page.locator('dialog.preview');
  await preview.getByLabel('Fine rotate').fill('-5');
  await expect(preview.locator('output')).toHaveText('-5.0°');
  await preview.getByRole('button', { name: 'Reset' }).click();
  await expect(preview.locator('output')).toHaveText('0.0°');
  await expect(preview.getByRole('button', { name: 'Reset' })).toBeDisabled();
  await preview.getByLabel('Fine rotate').fill('-5');
  await preview.getByRole('button', { name: 'Close preview' }).click();

  const out = await saveAll(page);
  const doc = mupdf.Document.openDocument(out, 'application/pdf').asPDF()!;
  const firstOp = (i: number) => {
    const c = doc.findPage(i).get('Contents');
    return c.isArray() ? c.get(0).readStream().asString() : '';
  };
  expect(firstOp(0)).toBe(''); // untouched pages keep their own content
  expect(firstOp(1)).toMatch(/^q 0\.996195 -?0\.087156 -?0\.087156 0\.996195 /);
  doc.destroy();

  await page.keyboard.press('Control+z'); // the slide
  await page.keyboard.press('Control+z'); // the reset
  await page.keyboard.press('Control+z'); // the first slide
  await cards(page).nth(1).locator('.hit').dblclick();
  await expect(preview.locator('output')).toHaveText('0.0°');
});

test('Straighten photo: corners flatten a photo page; Remove puts it back', async ({ page }) => {
  await addFiles(page, ['photo-of-sheet.jpg', 'tilted-scans.pdf'], 4);
  await cards(page).nth(1).locator('.hit').dblclick();
  const preview = page.locator('dialog.preview');
  await expect(preview.getByRole('button', { name: 'Straighten photo' })).toHaveCount(0); // PDF pages: not offered
  await preview.getByRole('button', { name: 'Previous page' }).click();
  await preview.getByRole('button', { name: 'Straighten photo' }).click();
  const editor = page.locator('dialog.photo-editor');
  await expect(editor.getByRole('heading', { name: 'Straighten photo' })).toBeVisible();
  // Move the top-left corner with the keyboard, then apply.
  await editor.getByRole('button', { name: /top-left corner/ }).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await editor.getByRole('button', { name: 'Apply' }).click();
  await expect(editor).toBeHidden();
  await preview.getByRole('button', { name: 'Close preview' }).click();

  const out = await saveAll(page);
  const doc = mupdf.Document.openDocument(out, 'application/pdf');
  expect(doc.countPages()).toBe(4);
  doc.destroy();

  await cards(page).first().locator('.hit').dblclick();
  await preview.getByRole('button', { name: 'Straighten photo' }).click();
  await editor.getByRole('button', { name: 'Remove' }).click();
  await expect(editor).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z'); // undo Remove: the corners come back
  await cards(page).first().locator('.hit').dblclick();
  await preview.getByRole('button', { name: 'Straighten photo' }).click();
  await expect(editor.getByRole('button', { name: 'Remove' })).toBeVisible();
});

test('Split book spreads: a 20-page book becomes 37 pages; the unsure one is shown in Review', async ({ page }) => {
  await addFiles(page, ['book-20.pdf'], 20);
  await page.getByRole('button', { name: 'Page tools' }).click();
  await page.getByRole('menuitem', { name: 'Split book spreads…' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.snack')).toContainText('Split 17 spreads into 34 pages; 1 to check.');
  await expect(cards(page)).toHaveCount(37);
  await expect(page.locator('.card .review')).toHaveCount(2); // both halves of the unsure spread
  await page.locator('.snack').getByRole('button', { name: 'Review' }).click();
  const editor = page.locator('dialog.split-editor[open]');
  await expect(editor.getByRole('heading', { name: 'Check split' })).toBeVisible();
  await editor.getByRole('slider', { name: /Split line/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await editor.getByRole('button', { name: 'Apply' }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('.card .review')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(37);
  // The whole batch is one undo step (after the review edit).
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(cards(page)).toHaveCount(20);
});

test('Split then export: each spread becomes two pages in reading order, with text on each', async ({ page }) => {
  await addFiles(page, ['spread-text.pdf'], 2);
  await page.getByRole('button', { name: 'Page tools' }).click();
  await page.getByRole('menuitem', { name: 'Split book spreads…' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.snack')).toContainText('Split 2 spreads into 4 pages.');
  const out = await saveAll(page);
  const order = [0, 1, 2, 3].map((i) => (textOf(out, i).includes('LEFT PAGE') ? 'L' : textOf(out, i).includes('RIGHT PAGE') ? 'R' : '?'));
  expect(order).toEqual(['L', 'R', 'L', 'R']);
  for (let i = 0; i < 4; i++) expect(textOf(out, i)).toMatch(/line 14 of the (left|right) page/);
});

test('one page split by hand from the preview, then put back with Don\'t split this page', async ({ page }) => {
  await addFiles(page, ['spread-scan.pdf', 'tilted-scans.pdf'], 4);
  await cards(page).first().locator('.hit').dblclick();
  await page.locator('dialog.preview').getByRole('button', { name: 'Split into two pages' }).click();
  const editor = page.locator('dialog.split-editor[open]');
  await expect(editor.getByRole('heading', { name: 'Split into two pages' })).toBeVisible();
  await editor.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(cards(page)).toHaveCount(5);
  const preview = page.locator('dialog.preview');
  await preview.getByRole('button', { name: 'Adjust split' }).click();
  await editor.getByRole('button', { name: "Don't split this page" }).click();
  await expect(cards(page)).toHaveCount(4);
});
