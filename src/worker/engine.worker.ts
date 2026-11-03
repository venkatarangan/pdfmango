// Worker entry. Registers the Comlink API immediately; the engine (and its 10 MB WASM) loads on
// first use, so no message can arrive before a listener exists.
import * as Comlink from 'comlink';
import type { ExportOptions, ExportPage, ExportProgress, ImageExportOptions, PageEdit, Rotation } from '../lib/types';

const engine = import('./engine');

/** Runs `fn` against the loaded engine, turning any failure into an Error whose message is a code. */
async function call<T>(fn: (e: typeof import('./engine')) => T | Promise<T>): Promise<T> {
  const e = await engine;
  try {
    return await fn(e);
  } catch (err) {
    throw new Error(e.toCode(err));
  }
}

const api = {
  /** Resolves once the WASM engine is compiled and ready. */
  async ready(): Promise<true> {
    await engine;
    return true;
  },
  open: (bytes: ArrayBuffer, respectRestrictions: boolean) => call((e) => e.open(bytes, respectRestrictions)),
  unlock: (sourceId: string, password: string, respectRestrictions: boolean) => call((e) => e.unlock(sourceId, password, respectRestrictions)),
  addImage: (bytes: ArrayBuffer) => call((e) => e.addImage(bytes)),
  addBlank: (widthPt: number, heightPt: number) => call((e) => e.addBlank(widthPt, heightPt)),
  convert: (kind: 'docx' | 'text', bytes: ArrayBuffer) => call((e) => e.convert(kind, bytes)),
  renderThumb: (sourceId: string, srcIndex: number, widthPx: number, edit?: PageEdit) =>
    call(async (e) => {
      const bmp = await createImageBitmap(e.renderThumb(sourceId, srcIndex, widthPx, edit));
      return Comlink.transfer(bmp, [bmp]);
    }),
  export: (pages: ExportPage[], opts: ExportOptions, onProgress: (p: ExportProgress) => void) =>
    call(async (e) => {
      const r = await e.exportPdf(pages, opts, onProgress);
      return Comlink.transfer(r, [r.bytes]);
    }),
  renderImage: (page: ExportPage, opts: ImageExportOptions) =>
    call((e) => {
      const r = e.renderImage(page, opts);
      return Comlink.transfer(r, [r.bytes]);
    }),
  detectSkew: (sourceId: string, srcIndex: number, edit?: PageEdit, addedRotation: Rotation = 0) => call((e) => e.detectSkew(sourceId, srcIndex, edit, addedRotation)),
  analyseSpread: (sourceId: string, srcIndex: number, addedRotation: Rotation, edit?: PageEdit) => call((e) => e.analyseSpread(sourceId, srcIndex, addedRotation, edit)),
  findSheetCorners: (sourceId: string) => call((e) => e.findSheetCorners(sourceId)),
  autoCrop: (sourceId: string, srcIndex: number, addedRotation: Rotation, edit?: PageEdit) => call((e) => e.autoCrop(sourceId, srcIndex, addedRotation, edit)),
  cancel: () => call((e) => e.cancel()),
  dispose: (sourceId: string) => call((e) => e.dispose(sourceId)),
  reset: () => call((e) => e.reset()),
};

export type EngineApi = typeof api;
Comlink.expose(api);
