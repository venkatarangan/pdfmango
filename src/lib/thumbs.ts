// Thumbnail scheduler: renders visible pages first, keeps a bounded cache of ImageBitmaps,
// drops requests for pages that scrolled away, and pauses while an export runs.
import { engine } from './engine';

type Waiter = (bmp: ImageBitmap) => void;
type Request = { key: string; sourceId: string; srcIndex: number; waiters: Set<Waiter> };

const MAX_CACHED = 240; // ~120 MB at 320 x 450 RGBA; visible pages are never evicted
const CONCURRENCY = 2;

export const thumbWidthPx = () => Math.round(160 * Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1)));

const cache = new Map<string, ImageBitmap>(); // insertion order = LRU order
const queue = new Map<string, Request>(); // insertion order = priority (first seen first)
const inFlight = new Set<string>();
const visible = new Map<string, number>(); // key -> number of visible cards showing it
let paused = false;
let generation = 0;

export const keyOf = (sourceId: string, srcIndex: number) => `${sourceId}:${srcIndex}`;

/** Asks for a thumbnail; `onReady` runs once it exists. Returns a function that withdraws the request. */
export function requestThumb(sourceId: string, srcIndex: number, onReady: Waiter): () => void {
  const key = keyOf(sourceId, srcIndex);
  visible.set(key, (visible.get(key) ?? 0) + 1);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // refresh LRU position
    onReady(hit);
    return () => release(key);
  }
  let req = queue.get(key);
  if (!req) queue.set(key, (req = { key, sourceId, srcIndex, waiters: new Set() }));
  req.waiters.add(onReady);
  pump();
  return () => {
    req.waiters.delete(onReady);
    if (req.waiters.size === 0 && !inFlight.has(key)) queue.delete(key);
    release(key);
  };
}

function release(key: string) {
  const n = (visible.get(key) ?? 1) - 1;
  if (n <= 0) visible.delete(key);
  else visible.set(key, n);
}

function pump() {
  if (paused) return;
  while (inFlight.size < CONCURRENCY) {
    const next = [...queue.values()].find((r) => !inFlight.has(r.key));
    if (!next) return;
    inFlight.add(next.key);
    const gen = generation;
    void render(next).finally(() => {
      if (gen !== generation) return;
      inFlight.delete(next.key);
      queue.delete(next.key);
      pump();
    });
  }
}

async function render(req: Request) {
  const gen = generation;
  try {
    const api = await engine();
    const bmp = await api.renderThumb(req.sourceId, req.srcIndex, thumbWidthPx());
    if (gen !== generation) {
      bmp.close();
      return;
    }
    cache.set(req.key, bmp);
    for (const w of req.waiters) w(bmp);
    evict();
  } catch {
    // A page that fails to render keeps its placeholder; the export will still try it.
  }
}

function evict() {
  if (cache.size <= MAX_CACHED) return;
  for (const [key, bmp] of cache) {
    if (cache.size <= MAX_CACHED) break;
    if (visible.has(key)) continue;
    bmp.close();
    cache.delete(key);
  }
}

/** Large one-off render for the preview; not cached. */
export async function renderLarge(sourceId: string, srcIndex: number, widthPx: number): Promise<ImageBitmap> {
  const api = await engine();
  return api.renderThumb(sourceId, srcIndex, widthPx);
}

export function pauseThumbs(p: boolean) {
  paused = p;
  if (!p) pump();
}

/** Forgets everything (Start over). */
export function resetThumbs() {
  generation++;
  for (const bmp of cache.values()) bmp.close();
  cache.clear();
  queue.clear();
  inFlight.clear();
  visible.clear();
  paused = false;
}
