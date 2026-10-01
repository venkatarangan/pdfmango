// Application state (Svelte 5 runes). Edits replace `pages` with a new array and record the old
// one for undo; nothing here talks to the worker except through the functions in actions.ts.
import * as model from './model';
import type { PageRef, PageSize, PdfNotices, Source } from './types';

export type SourceInfo = Source & { pageSizes: PageSize[]; notices?: PdfNotices };

class AppState {
  sources = $state.raw<ReadonlyMap<string, SourceInfo>>(new Map());
  pages = $state.raw<PageRef[]>([]);
  selection = $state.raw<ReadonlySet<string>>(new Set());
  history = $state.raw<model.History>({ undo: [], redo: [] });
  /** Last page clicked without Shift: the anchor for Shift+click ranges. */
  anchor: string | null = null;
  /** Files still being read or opened. */
  loading = $state(0);
  exporting = $state(false);

  usedBytes = $derived([...this.sources.values()].reduce((n, s) => n + s.sizeBytes, 0));
  hasImagePages = $derived(this.pages.some((p) => this.sources.get(p.sourceId)?.kind === 'image'));
  canUndo = $derived(this.history.undo.length > 0);
  canRedo = $derived(this.history.redo.length > 0);

  /** Sources that still contribute at least one page, in first-use order. */
  usedSources(): SourceInfo[] {
    const seen = new Map<string, SourceInfo>();
    for (const p of this.pages) {
      const s = this.sources.get(p.sourceId);
      if (s && !seen.has(s.id)) seen.set(s.id, s);
    }
    return [...seen.values()];
  }

  addSource(s: SourceInfo) {
    const next = new Map(this.sources);
    next.set(s.id, s);
    this.sources = next;
  }

  /** Applies an undoable edit to the page list. */
  edit(fn: (pages: PageRef[]) => PageRef[]) {
    const next = fn(this.pages);
    if (next === this.pages) return;
    this.history = model.pushHistory(this.history, this.pages);
    this.pages = next;
    this.selection = model.pruneSelection(next, this.selection);
  }

  undo() {
    const r = model.undo(this.history, this.pages);
    if (!r) return false;
    this.history = r.history;
    this.pages = r.pages;
    this.selection = model.pruneSelection(r.pages, this.selection);
    return true;
  }

  redo() {
    const r = model.redo(this.history, this.pages);
    if (!r) return false;
    this.history = r.history;
    this.pages = r.pages;
    this.selection = model.pruneSelection(r.pages, this.selection);
    return true;
  }

  select(uids: Iterable<string>) {
    this.selection = new Set(uids);
  }

  toggle(uid: string) {
    const next = new Set(this.selection);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    this.selection = next;
    this.anchor = uid;
  }

  selectRange(uid: string) {
    if (!this.anchor) return this.toggle(uid);
    this.selection = new Set([...this.selection, ...model.rangeBetween(this.pages, this.anchor, uid)]);
  }

  clear() {
    this.sources = new Map();
    this.pages = [];
    this.selection = new Set();
    this.history = { undo: [], redo: [] };
    this.anchor = null;
  }
}

export const app = new AppState();
