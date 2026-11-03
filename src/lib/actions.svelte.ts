// User-level operations that involve the worker: adding files, exporting, starting over.
import { track } from './analytics';
import { Comlink, engine, restartEngine } from './engine';
import { sniff } from './filetypes';
import { checkPages, checkSize, readDeviceEnv, sizeLimit } from './limits';
import * as model from './model';
import { newUid } from './model';
import { notify } from './notify.svelte';
import { app } from './state.svelte';
import { pauseThumbs, resetThumbs } from './thumbs';
import { finalFileName, defaultFileName, pageImageName } from './filenames';
import { plural, resultLine } from './format';
import { settings } from './settings.svelte';
import { zip } from './zip';
import { editOf, setFineRotations, shownSize } from './edits';
import { applyPlan, planSplits, type Measured, type SplitChoice } from './split';
import { config } from '../pdfmango.config';
import type { CompressionLevel, EngineErrorCode, ExportOptions, ExportPage, ExportProgress, ImageExportOptions, OpenResult, PageRef, PageSize } from './types';

export const MESSAGES: Record<EngineErrorCode, string> = {
  'wrong-password': 'That password is not right.',
  'not-a-pdf': "This file doesn't look like a PDF.",
  unreadable: "This PDF couldn't be read. It may be damaged beyond repair.",
  'image-unreadable': "This image couldn't be read. It may be damaged.",
  'word-unreadable': "This Word file couldn't be read. It may be damaged, or saved in an older format (.doc).",
  'out-of-memory': "This file is too large for this device's memory.",
  cancelled: 'Cancelled.',
  'export-failed': 'Something went wrong while saving. Your pages are unchanged; please try again.',
};

/** Longest codes first, so 'image-unreadable' is never mistaken for 'unreadable'. */
const CODES = (Object.keys(MESSAGES) as EngineErrorCode[]).sort((a, b) => b.length - a.length);

/** Worker errors arrive as Errors whose message is the code. */
export function errorCode(e: unknown): EngineErrorCode {
  const m = String((e as Error)?.message ?? e);
  return CODES.find((c) => m.includes(c)) ?? (/memory/i.test(m) ? 'out-of-memory' : 'export-failed');
}

function reportError(code: EngineErrorCode, prefix = '') {
  track({ name: 'error', params: { code } });
  notify.error(prefix + MESSAGES[code]);
  // After an out-of-memory error the WASM engine may be unusable; Start over gives a fresh one.
  if (code === 'out-of-memory') outOfMemory = true;
}
let outOfMemory = false;

// ---- Password prompt (resolved by PasswordDialog) ---------------------------------------------------

export type PasswordRequest = { fileName: string; wrong: boolean; resolve: (pw: string | null) => void };

class Prompts {
  password = $state<PasswordRequest | null>(null);
}
export const prompts = new Prompts();

function askPassword(fileName: string, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    prompts.password = {
      fileName,
      wrong,
      resolve: (pw) => {
        prompts.password = null;
        resolve(pw);
      },
    };
  });
}

// ---- Adding files -----------------------------------------------------------------------------------------

/** Adds files in the order given, appending their pages to the end of the grid. */
export async function addFiles(files: File[]) {
  if (files.length === 0) return;
  const limit = sizeLimit(readDeviceEnv(), settings.current);
  app.loading += files.length;
  let added = 0;
  try {
    for (const file of files) {
      try {
        added += await addOne(file, limit);
      } catch (e) {
        reportError(errorCode(e), `${file.name}: `);
      } finally {
        app.loading -= 1;
      }
    }
  } finally {
    if (added > 0) notify.announce(`Added ${added} ${added === 1 ? 'page' : 'pages'}. ${app.pages.length} in total.`);
  }
}

async function addOne(file: File, limit: ReturnType<typeof sizeLimit>): Promise<number> {
  const head = new Uint8Array(await file.slice(0, 1100).arrayBuffer());
  const kind = sniff(head, file.name);
  if (kind.kind === 'rejected') {
    notify.error(kind.message);
    return 0;
  }
  const tooBig = checkSize(limit, app.usedBytes, file.size);
  if (tooBig) {
    notify.error(`${file.name}: ${tooBig}`);
    return 0;
  }
  if (kind.kind === 'docx' || kind.kind === 'text') return addConverted(file, kind.kind);
  if (kind.kind === 'image') {
    const tooMany = checkPages(app.pages.length, 1);
    if (tooMany) {
      notify.error(tooMany);
      return 0;
    }
  }
  const api = await engine();
  const bytes = await file.arrayBuffer();

  if (kind.kind === 'image') {
    const r = await api.addImage(Comlink.transfer(bytes, [bytes]));
    app.addSource({ id: r.sourceId, name: file.name, kind: 'image', pageCount: 1, sizeBytes: file.size, pageSizes: [r.pageSize] });
    appendPages(r.sourceId, 1);
    track({ name: 'file_added', params: { kind: 'image' } });
    return 1;
  }

  const respect = settings.current.respectOwnerRestrictions;
  let r: OpenResult = await api.open(Comlink.transfer(bytes, [bytes]), respect);
  while (r.status === 'needs-password') {
    const pw = await askPassword(file.name, r.wrongPassword === true);
    if (pw === null) {
      await api.dispose(r.sourceId);
      return 0;
    }
    r = await api.unlock(r.sourceId, pw, respect);
  }
  if (r.status === 'restricted') {
    notify.error(`${file.name}: the author of this PDF has restricted page changes, so PDFMango can't edit it.`);
    return 0;
  }
  const tooMany = checkPages(app.pages.length, r.pageCount);
  if (tooMany) {
    await api.dispose(r.sourceId);
    notify.error(`${file.name}: ${tooMany}`);
    return 0;
  }
  app.addSource({ id: r.sourceId, name: file.name, kind: 'pdf', pageCount: r.pageCount, sizeBytes: file.size, pageSizes: r.pageSizes, notices: r.notices });
  appendPages(r.sourceId, r.pageCount);
  track({ name: 'file_added', params: { kind: 'pdf' } });
  if (r.notices.wasRepaired) notify.show(`${file.name} had errors and was repaired — check the result.`);
  if (r.notices.restricted) notify.show(`${file.name}: its author restricted page changes; your settings allow editing it anyway.`);
  return r.pageCount;
}

/** Word and text files are converted to PDF pages in the worker as they are added. */
async function addConverted(file: File, kind: 'docx' | 'text'): Promise<number> {
  const api = await engine();
  const bytes = await file.arrayBuffer();
  const r = await api.convert(kind, Comlink.transfer(bytes, [bytes]));
  if (r.status !== 'ok') return 0;
  const tooMany = checkPages(app.pages.length, r.pageCount);
  if (tooMany) {
    await api.dispose(r.sourceId);
    notify.error(`${file.name}: ${tooMany}`);
    return 0;
  }
  app.addSource({ id: r.sourceId, name: file.name, kind: 'converted', pageCount: r.pageCount, sizeBytes: file.size, pageSizes: r.pageSizes, notices: r.notices });
  appendPages(r.sourceId, r.pageCount);
  track({ name: 'file_added', params: { kind } });
  if (kind === 'docx' && !wordNoticeShown) {
    wordNoticeShown = true;
    notify.show(`${file.name} was converted. Fonts and layout can differ from Word; headers, footers and text boxes are left out.`);
  }
  return r.pageCount;
}
let wordNoticeShown = false;

function appendPages(sourceId: string, count: number) {
  const fresh: PageRef[] = Array.from({ length: count }, (_, i) => ({ uid: newUid(), sourceId, srcIndex: i, addedRotation: 0 }));
  app.edit((pages) => [...pages, ...fresh]);
}

/** Inserts a blank page after the last selected page (or at the end), the same size as that page. */
export async function insertBlankPage() {
  const tooMany = checkPages(app.pages.length, 1);
  if (tooMany) return notify.error(tooMany);
  const ref = app.pages.findLast((p) => app.selection.has(p.uid)) ?? app.pages.at(-1);
  const [w, h] = ref ? displayedSize(ref) : A4_PT;
  try {
    const sourceId = await (await engine()).addBlank(w, h);
    app.addSource({ id: sourceId, name: 'Blank page', kind: 'blank', pageCount: 1, sizeBytes: 0, pageSizes: [[w, h]] });
    app.edit((pages) => model.insertAfterSelection(pages, app.selection, [{ uid: newUid(), sourceId, srcIndex: 0, addedRotation: 0 }]));
    notify.announce('Inserted a blank page.');
  } catch (e) {
    reportError(errorCode(e));
  }
}

const A4_PT: PageSize = [595, 842];

/** Size of a page as it shows in the grid, including the rotation added in PDFMango (and any cut). */
function displayedSize(p: PageRef): PageSize {
  return shownSize(app.sources.get(p.sourceId)?.pageSizes[p.srcIndex] ?? A4_PT, editOf(p), p.addedRotation, config.straightenPhoto.maxSidePx);
}

/** What the worker needs to draw or export a page. Untouched pages carry no `edit`. */
export function toExportPage(p: PageRef): ExportPage {
  const { sourceId, srcIndex, addedRotation } = p;
  const edit = editOf(p);
  return edit ? { sourceId, srcIndex, addedRotation, edit } : { sourceId, srcIndex, addedRotation };
}

// ---- Export ---------------------------------------------------------------------------------------------------

export class ExportJob {
  progress = $state<ExportProgress | null>(null);
  running = $state(false);
  private cancelled = false;

  /** Builds the PDF without downloading it; null when cancelled or failed (the error is reported). */
  async build(fileName: string, level: CompressionLevel, opts: ExportOptions, chosen: readonly PageRef[] = app.pages): Promise<BuiltPdf | null> {
    if (this.running || chosen.length === 0) return null;
    this.running = true;
    this.cancelled = false;
    app.exporting = true;
    pauseThumbs(true);
    const used = app.usedSources(chosen);
    const inputSize = used.reduce((n, s) => n + s.sizeBytes, 0);
    const name = finalFileName(fileName, defaultFileName(used));
    try {
      const api = await engine();
      const pages = chosen.map(toExportPage);
      this.progress = { done: 0, total: pages.length, step: 'Starting' };
      const result = await api.export(
        pages,
        opts,
        Comlink.proxy((p: ExportProgress) => {
          if (!this.cancelled) this.progress = p;
        }),
      );
      track({ name: 'export', params: { level } });
      return { bytes: result.bytes, name, inputSize, outputSize: result.outputSize, fellBackToLossless: result.fellBackToLossless };
    } catch (e) {
      const code = errorCode(e);
      if (code !== 'cancelled') reportError(code);
      else notify.announce('Cancelled.');
      return null;
    } finally {
      this.running = false;
      this.progress = null;
      app.exporting = false;
      pauseThumbs(false);
    }
  }

  /** Builds and downloads in one go. */
  async run(fileName: string, level: CompressionLevel, opts: ExportOptions, chosen: readonly PageRef[] = app.pages): Promise<boolean> {
    const built = await this.build(fileName, level, opts, chosen);
    if (!built) return false;
    saveBuilt(built);
    return true;
  }

  async cancel() {
    if (!this.running) return;
    this.cancelled = true;
    this.progress = { done: 0, total: 1, step: 'Cancelling…' };
    await (await engine()).cancel();
  }
}

/** A finished PDF, kept in memory so it can be previewed, downloaded or shared without rebuilding. */
export type BuiltPdf = { bytes: ArrayBuffer; name: string; inputSize: number; outputSize: number; fellBackToLossless: boolean };

/** Pages saved as images, kept in memory until they are shared or downloaded. */
export type BuiltImages = { files: File[]; totalBytes: number; base: string };

export class ImageJob {
  progress = $state<ExportProgress | null>(null);
  running = $state(false);
  private cancelled = false;

  /** Renders the chosen pages one at a time (so a long job can be cancelled between pages). */
  async build(base: string, chosen: readonly PageRef[], opts: ImageExportOptions): Promise<BuiltImages | null> {
    if (this.running || chosen.length === 0) return null;
    this.running = true;
    this.cancelled = false;
    app.exporting = true;
    pauseThumbs(true);
    try {
      const api = await engine();
      const position = new Map(app.pages.map((p, i) => [p.uid, i + 1]));
      const files: File[] = [];
      let totalBytes = 0;
      for (let i = 0; i < chosen.length; i++) {
        if (this.cancelled) throw new Error('cancelled');
        this.progress = { done: i, total: chosen.length, step: `Saving page ${i + 1} of ${chosen.length} as an image` };
        const { uid } = chosen[i];
        const r = await api.renderImage(toExportPage(chosen[i]), opts);
        const name = pageImageName(base, position.get(uid) ?? i + 1, app.pages.length, r.ext);
        files.push(new File([r.bytes], name, { type: r.ext === 'png' ? 'image/png' : 'image/jpeg' }));
        totalBytes += r.bytes.byteLength;
      }
      return { files, totalBytes, base };
    } catch (e) {
      const code = errorCode(e);
      if (code !== 'cancelled') reportError(code);
      else notify.announce('Cancelled.');
      return null;
    } finally {
      this.running = false;
      this.progress = null;
      app.exporting = false;
      pauseThumbs(false);
    }
  }

  cancel() {
    if (!this.running) return;
    this.cancelled = true;
    this.progress = { done: 0, total: 1, step: 'Cancelling…' };
  }
}

/** One image downloads as itself; several download as one ZIP (browsers block a burst of downloads). */
export async function saveImages(b: BuiltImages) {
  if (b.files.length === 1) return downloadBlob(b.files[0], b.files[0].name);
  const entries = await Promise.all(b.files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  downloadBlob(zip(entries), `${b.base}-pages.zip`);
}

/** True where these images can go to the share sheet (most phones; desktop Chrome caps the count). */
export function canShareImages(b: BuiltImages): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: b.files });
  } catch {
    return false;
  }
}

/** Opens the system share sheet with every image. Must run straight from a tap. */
export async function shareImages(b: BuiltImages) {
  try {
    await navigator.share({ files: b.files });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
    notify.error("Sharing didn't work on this device. Use Download instead.");
  }
}

export function resultMessage(b: BuiltPdf): string {
  const line = resultLine(b.inputSize, b.outputSize);
  return b.fellBackToLossless ? `${line}. This file was already well compressed.` : line;
}

/** Downloads a built PDF and reports the size change. */
export function saveBuilt(b: BuiltPdf) {
  downloadBytes(b.bytes, b.name);
  notify.show(resultMessage(b));
}

/** True where the browser can hand a PDF to other apps (iPhone, Android, some desktops). */
export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'probe.pdf', { type: 'application/pdf' });
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Opens the system share sheet with the PDF. Must run straight from a tap (browsers require it). */
export async function shareBuilt(b: BuiltPdf) {
  const file = new File([b.bytes], b.name, { type: 'application/pdf' });
  try {
    await navigator.share({ files: [file], title: b.name });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return; // the visitor closed the share sheet
    notify.error("Sharing didn't work on this device. Use Download instead.");
  }
}

export function downloadBytes(bytes: ArrayBuffer, name: string) {
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), name);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  // Keep the click away from page-level listeners (analytics must never see a file name).
  a.addEventListener('click', (e) => e.stopPropagation());
  document.body.append(a);
  a.click();
  a.remove();
  // Safari needs the URL to live a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---- Page tools that run in the worker (Straighten, Split) --------------------------------------------

/** A page tool running over many pages, with progress and Cancel (BatchDialog shows it). */
class BatchJob {
  title = $state('');
  progress = $state<ExportProgress | null>(null);
  running = $state(false);
  cancelled = false;

  start(title: string, total: number) {
    this.title = title;
    this.cancelled = false;
    this.running = true;
    this.progress = { done: 0, total, step: '' };
    app.exporting = true; // keeps other edits out until the job finishes
  }

  step(done: number, step: string) {
    if (this.progress) this.progress = { ...this.progress, done, step };
  }

  finish() {
    this.running = false;
    this.progress = null;
    app.exporting = false;
  }

  cancel() {
    this.cancelled = true;
  }
}
export const batch = new BatchJob();

const deg = (a: number) => `${Math.abs(a).toFixed(1).replace(/\.0$/, '')}°`;

/**
 * Straighten: measures the tilt of each page's text lines in the worker and turns the page back
 * (losslessly, at export). A page with no clear lines is left alone. One undoable edit.
 */
export async function straightenPages(uids: ReadonlySet<string>, opts: { quiet?: boolean } = {}): Promise<string> {
  if (batch.running || app.exporting) return '';
  const targets = app.pages.filter((p) => uids.size === 0 || uids.has(p.uid));
  if (targets.length === 0) return '';
  batch.start(targets.length === 1 ? 'Straightening the page' : `Straightening ${targets.length} pages`, targets.length);
  const angles = new Map<string, number>();
  let tilted = 0;
  let straight = 0;
  let unsure = 0;
  let lastAngle = 0;
  try {
    const api = await engine();
    const seen = new Map<string, Awaited<ReturnType<typeof api.detectSkew>>>();
    for (let i = 0; i < targets.length; i++) {
      if (batch.cancelled) {
        notify.announce('Cancelled. No pages were changed.');
        return '';
      }
      const p = targets[i];
      batch.step(i, `Checking page ${i + 1} of ${targets.length}`);
      // A duplicated page shares its source page and edits, so it is measured once.
      const key = `${p.sourceId}:${p.srcIndex}:${JSON.stringify(p.crop ?? null)}:${JSON.stringify(p.corners ?? null)}`;
      let r = seen.get(key);
      if (!r) seen.set(key, (r = await api.detectSkew(p.sourceId, p.srcIndex, editOf(p))));
      if (r.verdict === 'tilted') {
        tilted++;
        lastAngle = r.angle;
        angles.set(p.uid, -r.angle);
      } else if (r.verdict === 'straight') {
        straight++;
        angles.set(p.uid, 0);
      } else unsure++;
    }
  } catch (e) {
    reportError(errorCode(e));
    return '';
  } finally {
    batch.finish();
  }
  app.edit((pages) => setFineRotations(pages, angles));
  // The page preview shows the result itself (a snackbar would sit behind it).
  const say = (msg: string) => {
    if (opts.quiet) notify.announce(msg);
    else notify.show(msg);
    return msg;
  };
  if (targets.length === 1) {
    if (tilted) return say(`Straightened by ${deg(lastAngle)}.`);
    if (straight) return say('Already straight.');
    return say('No clear lines of text to straighten by, so the page was left as it is.');
  }
  const parts = [tilted ? `Straightened ${plural(tilted, 'page')}.` : 'No page needed straightening.'];
  if (straight) parts.push(`${plural(straight, 'page')} already straight.`);
  if (unsure) parts.push(`${plural(unsure, 'page')} left as ${unsure === 1 ? 'it was' : 'they were'} (no clear lines of text).`);
  return say(parts.join(' '));
}

/** Sets one page's fine rotation (the slider in the page preview). One undoable edit. */
export function setFineRotation(uid: string, angle: number) {
  app.edit((pages) => setFineRotations(pages, new Map([[uid, angle]])));
}

// ---- Split book spreads ---------------------------------------------------------------------------------

/** Split choices, remembered for this visit only. */
class SplitPrefs {
  overlap = $state<number>(config.split.defaultOverlap);
  rightFirst = $state(false);
}
export const splitPrefs = new SplitPrefs();

/** Split editor requests: one page to split by hand, or a list of spreads to check one after another. */
export type SplitTarget = { mode: 'manual'; uid: string } | { mode: 'review'; ids: string[]; adjust?: true };
class SplitUi {
  target = $state<SplitTarget | null>(null);
}
export const splitUi = new SplitUi();

/** Spreads that still carry a "Check split" badge, in page order. */
export function spreadsToCheck(): string[] {
  const ids: string[] = [];
  for (const p of app.pages) if (p.review && p.spread && !ids.includes(p.spread.id)) ids.push(p.spread.id);
  return ids;
}

export function reviewSplits() {
  const ids = spreadsToCheck();
  if (ids.length) splitUi.target = { mode: 'review', ids };
}

/** How far the top and bottom of the spine may differ (share of the width) before it counts as slanted. */
const SLANT_LIMIT = 0.01;

/**
 * Split book spreads: finds two-page spreads among the selected pages (or all pages) and splits
 * each into two pages. Pages already split are skipped. The whole batch is one undoable edit.
 */
export async function splitSpreads(uids: ReadonlySet<string>, choice: SplitChoice) {
  if (batch.running || app.exporting) return;
  const targets = app.pages.filter((p) => (uids.size === 0 || uids.has(p.uid)) && !p.crop);
  if (targets.length === 0) return notify.show('These pages are already split.');
  batch.start(`Looking for book spreads in ${plural(targets.length, 'page')}`, targets.length);
  const measured: Measured[] = [];
  const fine = new Map<string, number>();
  try {
    const api = await engine();
    for (let i = 0; i < targets.length; i++) {
      if (batch.cancelled) {
        notify.announce('Cancelled. No pages were changed.');
        return;
      }
      const p = targets[i];
      batch.step(i, `Checking page ${i + 1} of ${targets.length}`);
      let edit = editOf(p);
      let a = await api.analyseSpread(p.sourceId, p.srcIndex, p.addedRotation, edit);
      // A slanted spine usually means a tilted page: straighten it first (if it has not been), then look again.
      if (a.landscape && a.bothHalves && Math.abs(a.slant) > SLANT_LIMIT && !p.fineRotation) {
        const skew = await api.detectSkew(p.sourceId, p.srcIndex, edit);
        if (skew.verdict === 'tilted') {
          fine.set(p.uid, -skew.angle);
          edit = { ...edit, fineRotation: -skew.angle };
          a = await api.analyseSpread(p.sourceId, p.srcIndex, p.addedRotation, edit);
        }
      }
      measured.push({ uid: p.uid, landscape: a.landscape, bothHalves: a.bothHalves, at: a.gutter.at, z: a.gutter.z, slanted: Math.abs(a.slant) > SLANT_LIMIT });
    }
  } catch (e) {
    reportError(errorCode(e));
    return;
  } finally {
    batch.finish();
  }
  const plan = planSplits(measured, config.split.minConfidence);
  // Only pages that are split keep the straightening found for them.
  for (const uid of [...fine.keys()]) if (!plan.split.has(uid)) fine.delete(uid);
  app.edit((pages) => applyPlan(pages, plan, fine, choice));
  const n = plan.split.size;
  const check = [...plan.split.values()].filter((d) => d.review).length;
  if (n === 0) {
    notify.show(
      plan.unclear
        ? `No clear book spreads found. ${plural(plan.unclear, 'wide page')} had no clear spine; open one and use Split into two pages.`
        : 'No book spreads found. Spreads are pages wider than tall with a page on each side.',
    );
    return;
  }
  let text = `Split ${plural(n, 'spread')} into ${plural(n * 2, 'page')}`;
  if (check) text += `; ${check} to check`;
  text += '.';
  if (plan.unclear) text += ` ${plural(plan.unclear, 'wide page')} left as ${plan.unclear === 1 ? 'it was' : 'they were'} (no clear spine).`;
  notify.show(text, 'info', check ? { label: 'Review', run: reviewSplits } : undefined);
}

/** Asks the worker where the spine of one page probably is (for the manual split editor). */
export async function guessSpine(p: PageRef): Promise<number> {
  try {
    const a = await (await engine()).analyseSpread(p.sourceId, p.srcIndex, p.addedRotation, editOf(p));
    return a.gutter.z >= config.split.minConfidence / 2 ? a.gutter.at : 0.5;
  } catch {
    return 0.5;
  }
}

// ---- Start over ---------------------------------------------------------------------------------------------

export async function startOver() {
  app.clear();
  resetThumbs();
  if (outOfMemory) {
    outOfMemory = false;
    restartEngine();
  } else {
    try {
      await (await engine()).reset();
    } catch {
      restartEngine();
    }
  }
  notify.announce('Cleared. Add files to start again.');
}
