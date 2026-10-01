// User-level operations that involve the worker: adding files, exporting, starting over.
import { track } from './analytics';
import { Comlink, engine, restartEngine } from './engine';
import { sniff } from './filetypes';
import { checkPages, checkSize, readDeviceEnv, sizeLimit } from './limits';
import { newUid } from './model';
import { notify } from './notify.svelte';
import { app } from './state.svelte';
import { pauseThumbs, resetThumbs } from './thumbs';
import { finalFileName, defaultFileName } from './filenames';
import { resultLine } from './format';
import type { EngineErrorCode, ExportOptions, ExportProgress, OpenResult, PageRef } from './types';

export const MESSAGES: Record<EngineErrorCode, string> = {
  'wrong-password': 'That password is not right.',
  'not-a-pdf': "This file doesn't look like a PDF.",
  unreadable: "This PDF couldn't be read. It may be damaged beyond repair.",
  'image-unreadable': "This image couldn't be read. It may be damaged.",
  'out-of-memory': "This file is too large for this device's memory.",
  cancelled: 'Cancelled.',
  'export-failed': 'Something went wrong while building the PDF. Your pages are unchanged; please try again.',
};

/** Worker errors arrive as Errors whose message is the code. */
export function errorCode(e: unknown): EngineErrorCode {
  const m = String((e as Error)?.message ?? e);
  return (Object.keys(MESSAGES) as EngineErrorCode[]).find((c) => m.includes(c)) ?? (/memory/i.test(m) ? 'out-of-memory' : 'export-failed');
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
  const limit = sizeLimit(readDeviceEnv());
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

  let r: OpenResult = await api.open(Comlink.transfer(bytes, [bytes]));
  while (r.status === 'needs-password') {
    const pw = await askPassword(file.name, r.wrongPassword === true);
    if (pw === null) {
      await api.dispose(r.sourceId);
      return 0;
    }
    r = await api.unlock(r.sourceId, pw);
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
  if (r.notices.restricted) notify.show(`${file.name}: its author restricted page changes; the site owner allows editing anyway.`);
  return r.pageCount;
}

function appendPages(sourceId: string, count: number) {
  const fresh: PageRef[] = Array.from({ length: count }, (_, i) => ({ uid: newUid(), sourceId, srcIndex: i, addedRotation: 0 }));
  app.edit((pages) => [...pages, ...fresh]);
}

// ---- Export ---------------------------------------------------------------------------------------------------

export class ExportJob {
  progress = $state<ExportProgress | null>(null);
  running = $state(false);
  private cancelled = false;

  async run(fileName: string, opts: ExportOptions): Promise<boolean> {
    if (this.running || app.pages.length === 0) return false;
    this.running = true;
    this.cancelled = false;
    app.exporting = true;
    pauseThumbs(true);
    const used = app.usedSources();
    const inputSize = used.reduce((n, s) => n + s.sizeBytes, 0);
    const name = finalFileName(fileName, defaultFileName(used));
    try {
      const api = await engine();
      const pages = app.pages.map(({ sourceId, srcIndex, addedRotation }) => ({ sourceId, srcIndex, addedRotation }));
      this.progress = { done: 0, total: pages.length, step: 'Starting' };
      const result = await api.export(
        pages,
        opts,
        Comlink.proxy((p: ExportProgress) => {
          if (!this.cancelled) this.progress = p;
        }),
      );
      downloadBytes(result.bytes, name);
      track({ name: 'export', params: { level: opts.level } });
      let line = resultLine(inputSize, result.outputSize);
      if (result.fellBackToLossless) line += '. This file was already well compressed.';
      notify.show(line);
      return true;
    } catch (e) {
      const code = errorCode(e);
      if (code !== 'cancelled') reportError(code);
      else notify.announce('Download cancelled.');
      return false;
    } finally {
      this.running = false;
      this.progress = null;
      app.exporting = false;
      pauseThumbs(false);
    }
  }

  async cancel() {
    if (!this.running) return;
    this.cancelled = true;
    this.progress = { done: 0, total: 1, step: 'Cancelling…' };
    await (await engine()).cancel();
  }
}

export function downloadBytes(bytes: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
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
