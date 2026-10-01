// Main-thread handle on the engine worker. The worker (and its WASM) starts after first paint.
import * as Comlink from 'comlink';
import type { EngineApi } from '../worker/engine.worker';

let worker: Worker | null = null;
let api: Comlink.Remote<EngineApi> | null = null;
let ready: Promise<unknown> | null = null;

export function startEngine(): Comlink.Remote<EngineApi> {
  if (!api) {
    worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module', name: 'pdfmango-engine' });
    api = Comlink.wrap<EngineApi>(worker);
    ready = api.ready();
    ready.catch(() => {}); // surfaced by whichever call needs the engine
  }
  return api;
}

/** Starts the engine once the first frame is on screen, so it never delays the first paint. */
export function warmUpAfterFirstPaint() {
  requestAnimationFrame(() => setTimeout(() => startEngine(), 0));
}

export async function engine(): Promise<Comlink.Remote<EngineApi>> {
  const a = startEngine();
  await ready;
  return a;
}

/** Throws the worker away (frees all its memory, including after an out-of-memory error). */
export function restartEngine() {
  worker?.terminate();
  worker = null;
  api = null;
  ready = null;
  startEngine();
}

export { Comlink };
