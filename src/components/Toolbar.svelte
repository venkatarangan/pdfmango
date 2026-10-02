<script lang="ts">
  import { insertBlankPage } from '../lib/actions.svelte';
  import { isMobile, readDeviceEnv } from '../lib/limits';
  import { MAX_IMAGES_ON_PHONES } from '../lib/page-images';
  import { app } from '../lib/state.svelte';
  import * as model from '../lib/model';
  import { notify } from '../lib/notify.svelte';
  import { plural } from '../lib/format';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';

  type Props = {
    onadd: () => void;
    /** Saves the whole document (the export window opens on every page). */
    ondownload: () => void;
    /** Saves only the selected pages, as a PDF or as images. */
    onextract: (mode: 'pdf' | 'images') => void;
    onstartover: () => void;
    ondeleteall: () => void;
  };
  let { onadd, ondownload, onextract, onstartover, ondeleteall }: Props = $props();

  const count = $derived(app.selection.size);
  const scope = $derived(count ? 'selected' : 'all');
  const allSelected = $derived(app.pages.length > 0 && count === app.pages.length);
  const empty = $derived(app.pages.length === 0);
  const busy = $derived(app.exporting);
  const saveLabel = $derived(app.pages.length === 1 ? 'Save' : `Save all ${app.pages.length} pages`);
  // Phones share at most MAX_IMAGES_ON_PHONES images at a time; computers have no limit.
  const imagesBlocked = $derived(isMobile(readDeviceEnv()) && count > MAX_IMAGES_ON_PHONES);

  function rotate(delta: number) {
    const n = count || app.pages.length;
    app.edit((p) => model.rotatePages(p, app.selection, delta));
    notify.announce(`Rotated ${plural(n, 'page')} ${delta < 0 ? 'left' : 'right'}.`);
  }

  function remove() {
    if (count === 0) return ondeleteall();
    app.edit((p) => model.deletePages(p, app.selection));
    notify.announce(`Deleted ${plural(count, 'page')}. ${app.pages.length} left.`);
  }

  function move(delta: -1 | 1) {
    app.edit((p) => model.moveSelection(p, app.selection, delta));
  }

  function toggleAll() {
    app.select(allSelected ? [] : app.pages.map((p) => p.uid));
  }

  function duplicate() {
    app.edit((p) => model.duplicatePages(p, app.selection));
    notify.announce(`Duplicated ${plural(count, 'page')}. ${app.pages.length} in total.`);
  }

  function reverse() {
    const n = count || app.pages.length;
    app.edit((p) => model.reversePages(p, app.selection));
    notify.announce(`Reversed the order of ${plural(n, 'page')}.`);
  }

  function selectOddEven(which: 'odd' | 'even') {
    const uids = model.oddEvenUids(app.pages, which);
    app.select(uids);
    notify.announce(`Selected ${plural(uids.length, `${which} page`)}.`);
  }

  // One menu for the desktop toolbar, one for the phone bar; only one is ever open.
  let menuOpen = $state<'desk' | 'phone' | null>(null);
  let deskMenu: HTMLDivElement | undefined = $state();
  let phoneMenu: HTMLDivElement | undefined = $state();
  function menuAction(fn: () => void) {
    menuOpen = null;
    fn();
  }
  $effect(() => {
    if (!menuOpen) return;
    const menu = menuOpen === 'desk' ? deskMenu : phoneMenu;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu?.contains(e.target as Node)) menuOpen = null;
    };
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', close);
      document.addEventListener('keydown', close);
    });
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  });
</script>

<!-- Page tools shared by both menus. Each is one undoable edit. -->
{#snippet pageTools()}
  <button type="button" role="menuitem" onclick={() => menuAction(duplicate)} disabled={count === 0 || busy}><Icon name="duplicate" />Duplicate selected</button>
  <button type="button" role="menuitem" onclick={() => menuAction(() => void insertBlankPage())} disabled={busy}><Icon name="blankPage" />Insert blank page</button>
  <button type="button" role="menuitem" onclick={() => menuAction(reverse)} disabled={empty || busy}><Icon name="reverse" />Reverse order of {scope}</button>
  <button type="button" role="menuitem" onclick={() => menuAction(() => selectOddEven('odd'))} disabled={empty}><Icon name="selectAll" />Select odd pages</button>
  <button type="button" role="menuitem" onclick={() => menuAction(() => selectOddEven('even'))} disabled={app.pages.length < 2}><Icon name="selectAll" />Select even pages</button>
{/snippet}

<!-- Desktop / tablet: toolbar (and the selection bar) stick under the app bar -->
<div class="bars">
  <div class="toolbar" role="toolbar" aria-label="Page actions">
    <button type="button" class="btn btn-outlined add" onclick={onadd} disabled={busy}>
      <Icon name="add" /> Add files
    </button>
    <span class="sep" aria-hidden="true"></span>
    <IconButton icon="rotateLeft" label="Rotate {scope} left" onclick={() => rotate(-90)} disabled={empty || busy} />
    <IconButton icon="rotateRight" label="Rotate {scope} right" onclick={() => rotate(90)} disabled={empty || busy} />
    <IconButton icon="delete" label="Delete {scope}" onclick={remove} disabled={empty || busy} />
    <span class="sep" aria-hidden="true"></span>
    <IconButton icon="chevronLeft" label="Move selected left" onclick={() => move(-1)} disabled={count === 0 || busy} />
    <IconButton icon="chevronRight" label="Move selected right" onclick={() => move(1)} disabled={count === 0 || busy} />
    <IconButton icon={allSelected ? 'deselect' : 'selectAll'} label={allSelected ? 'Clear selection' : 'Select all'} onclick={toggleAll} disabled={empty} />
    <div class="more" bind:this={deskMenu}>
      <button type="button" class="btn btn-text tools" aria-haspopup="menu" aria-expanded={menuOpen === 'desk'} onclick={() => (menuOpen = menuOpen === 'desk' ? null : 'desk')}>
        Page tools <Icon name="chevronDown" />
      </button>
      {#if menuOpen === 'desk'}
        <div class="menu down" role="menu">{@render pageTools()}</div>
      {/if}
    </div>
    <span class="sep" aria-hidden="true"></span>
    <IconButton icon="undo" label="Undo (Ctrl+Z)" onclick={() => app.undo()} disabled={!app.canUndo || busy} />
    <IconButton icon="redo" label="Redo (Shift+Ctrl+Z)" onclick={() => app.redo()} disabled={!app.canRedo || busy} />
    <span class="status" aria-hidden="true">{plural(app.pages.length, 'page')}</span>
    <button type="button" class="btn btn-text" onclick={onstartover} disabled={busy}>
      <Icon name="startOver" /> Start over
    </button>
    <button type="button" class="btn btn-filled" onclick={ondownload} disabled={empty || busy}>
      <Icon name="download" /> {saveLabel}
    </button>
  </div>

  <!-- Shown while pages are selected: names the selection and offers what can be done with just those pages.
       Desktop: a row under the toolbar. Phones: a bar over the top of the screen, as in photo apps. -->
  {#if count > 0}
    <div class="selbar" role="toolbar" aria-label="Selected pages">
      <div class="sel-row">
        <IconButton icon="close" label="Clear selection (Esc)" onclick={() => app.select([])} />
        <span class="sel-count" aria-live="polite">{count} selected</span>
        <IconButton icon="duplicate" label="Duplicate selected" onclick={duplicate} disabled={busy} />
      </div>
      <div class="sel-actions">
        <button type="button" class="btn btn-outlined" onclick={() => onextract('pdf')} disabled={busy}>
          <Icon name="pdf" /> <span>Extract<span class="wide">{' '}as</span> PDF</span>
        </button>
        <button type="button" class="btn btn-outlined" onclick={() => onextract('images')} disabled={busy || imagesBlocked} aria-describedby={imagesBlocked ? 'sel-limit' : undefined} title={imagesBlocked ? `Phones extract up to ${MAX_IMAGES_ON_PHONES} pages as images at a time.` : undefined}>
          <Icon name="image" /> <span>Extract<span class="wide">{' '}as</span> images</span>
        </button>
      </div>
      {#if imagesBlocked}
        <p class="sel-limit" id="sel-limit">Phones extract up to {MAX_IMAGES_ON_PHONES} pages as images at a time.</p>
      {/if}
    </div>
  {/if}
</div>

<!-- Phones: bottom bar of labelled icons, Save at the right end -->
<div class="bottombar" role="toolbar" aria-label="Page actions">
  <button type="button" class="bb" onclick={onadd} disabled={busy}><Icon name="add" /><span>Add</span></button>
  <button type="button" class="bb" aria-label="Rotate {scope} left" onclick={() => rotate(-90)} disabled={empty || busy}><Icon name="rotateLeft" /><span>Left</span></button>
  <button type="button" class="bb" aria-label="Rotate {scope} right" onclick={() => rotate(90)} disabled={empty || busy}><Icon name="rotateRight" /><span>Right</span></button>
  <button type="button" class="bb" aria-label="Delete {scope}" onclick={remove} disabled={empty || busy}><Icon name="delete" /><span>Delete</span></button>
  <div class="more" bind:this={phoneMenu}>
    <button type="button" class="bb" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen === 'phone'} onclick={() => (menuOpen = menuOpen === 'phone' ? null : 'phone')}>
      <Icon name="more" /><span>More</span>
    </button>
    {#if menuOpen === 'phone'}
      <div class="menu" role="menu">
        <button type="button" role="menuitem" onclick={() => menuAction(toggleAll)} disabled={empty}>
          <Icon name={allSelected ? 'deselect' : 'selectAll'} />{allSelected ? 'Clear selection' : 'Select all'}
        </button>
        <button type="button" role="menuitem" onclick={() => menuAction(() => app.undo())} disabled={!app.canUndo}><Icon name="undo" />Undo</button>
        <button type="button" role="menuitem" onclick={() => menuAction(() => app.redo())} disabled={!app.canRedo}><Icon name="redo" />Redo</button>
        <button type="button" role="menuitem" onclick={() => menuAction(() => move(-1))} disabled={count === 0}><Icon name="chevronLeft" />Move selected left</button>
        <button type="button" role="menuitem" onclick={() => menuAction(() => move(1))} disabled={count === 0}><Icon name="chevronRight" />Move selected right</button>
        {@render pageTools()}
        <button type="button" role="menuitem" onclick={() => menuAction(onstartover)}><Icon name="startOver" />Start over</button>
      </div>
    {/if}
  </div>
  <button type="button" class="btn btn-filled download" aria-label={saveLabel} onclick={ondownload} disabled={empty || busy}>
    <Icon name="download" /> <span>Save{#if app.pages.length > 1}<span class="wide">{' '}all</span>{/if}</span>
  </button>
</div>

<style>
  .bars {
    position: sticky;
    top: var(--appbar-h);
    z-index: 15;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 64px;
    padding: 8px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--outline);
    flex-wrap: wrap;
  }
  .add {
    padding: 0 18px 0 12px;
  }
  .sep {
    width: 1px;
    height: 24px;
    margin: 0 6px;
    background: var(--outline);
  }
  .status {
    margin-left: auto;
    margin-right: 8px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .toolbar .btn-filled {
    padding: 0 22px 0 16px;
  }
  .bottombar {
    display: none;
  }
  .tools {
    padding: 0 6px 0 14px;
  }
  .selbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 6px 16px;
    background: var(--mango-tint);
    border-bottom: 1px solid var(--outline);
  }
  .sel-row,
  .sel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sel-count {
    font-weight: 600;
    margin-right: 8px;
    white-space: nowrap;
  }
  .sel-actions .btn {
    background: var(--bg);
  }
  .sel-limit {
    margin: 0;
    color: var(--text-2);
    font-size: 13px;
  }

  @media (max-width: 720px) {
    .toolbar {
      display: none;
    }
    .bottombar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
      background: var(--surface);
      border-top: 1px solid var(--outline);
      box-shadow: 0 -1px 3px rgb(0 0 0 / 0.06);
    }
    /* The selection bar is fixed over the app bar, so its sticky parent must sit above the app bar too. */
    .bars {
      z-index: 40;
    }
    .download {
      flex: none;
      margin-left: auto;
      padding: 0 14px 0 10px;
    }
    .bb {
      flex: 1 1 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-width: 40px;
      max-width: 64px;
      min-height: 52px;
      padding: 4px 2px;
      border: 0;
      border-radius: 12px;
      background: transparent;
      color: var(--text);
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
      cursor: pointer;
    }
    .bb:disabled {
      opacity: 0.4;
    }
    .bb:active:not(:disabled) {
      background: rgb(28 27 31 / 0.08);
    }
    /* Selection bar sits over the top of the screen, like photo apps. */
    .selbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 40;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      padding: max(6px, env(safe-area-inset-top)) 8px 10px;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
    }
    .sel-count {
      flex: 1;
    }
    .sel-actions .btn {
      flex: 1 1 0;
      min-width: 0;
      min-height: 44px;
      padding: 0 8px;
      white-space: nowrap;
    }
  }
  /* Narrow phones: shorter labels so nothing scrolls sideways. */
  @media (max-width: 400px) {
    .wide {
      display: none;
    }
  }
  @media (max-width: 360px) {
    .sel-actions .btn :global(svg) {
      display: none;
    }
  }
  .more {
    position: relative;
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    min-width: 220px;
    max-height: calc(100dvh - 160px);
    overflow-y: auto;
    padding: 8px 0;
    border-radius: var(--radius);
    background: var(--bg);
    box-shadow: var(--elev-3);
  }
  .menu.down {
    bottom: auto;
    top: calc(100% + 8px);
    z-index: 20;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 0 16px;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover:not(:disabled) {
    background: rgb(28 27 31 / 0.06);
  }
  .menu button:disabled {
    opacity: 0.4;
  }
</style>
