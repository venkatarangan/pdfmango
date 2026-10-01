<script lang="ts">
  import Sortable from 'sortablejs';
  import { tick } from 'svelte';
  import { app } from '../lib/state.svelte';
  import * as model from '../lib/model';
  import { notify } from '../lib/notify.svelte';
  import PageCard from './PageCard.svelte';

  type Props = { onpreview: (uid: string) => void };
  let { onpreview }: Props = $props();

  let grid: HTMLUListElement | undefined = $state();
  /** The card that holds the grid's single tab stop. */
  let activeUid = $state<string | null>(null);
  const active = $derived(activeUid && app.pages.some((p) => p.uid === activeUid) ? activeUid : (app.pages[0]?.uid ?? null));

  // Drag to reorder (mouse, and long-press then drag on touch). SortableJS moves the DOM node;
  // we put it back and let the page list drive the DOM, so Svelte stays in charge.
  $effect(() => {
    if (!grid) return;
    const sortable = Sortable.create(grid, {
      animation: 170,
      delay: 300,
      delayOnTouchOnly: true,
      touchStartThreshold: 6,
      draggable: '.card',
      filter: '.actions',
      preventOnFilter: false,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd(evt) {
        const { oldIndex, newIndex, item, from } = evt;
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
        item.remove();
        from.insertBefore(item, from.children[oldIndex] ?? null);
        app.edit((pages) => model.movePage(pages, oldIndex, newIndex));
        notify.announce(`Moved page ${oldIndex + 1} to position ${newIndex + 1}.`);
      },
    });
    return () => sortable.destroy();
  });

  async function focusCard(uid: string | undefined) {
    if (!uid) return;
    activeUid = uid;
    await tick();
    grid?.querySelector<HTMLButtonElement>(`[data-uid="${uid}"] .hit`)?.focus();
  }

  function columns(): number {
    if (!grid) return 1;
    return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  }

  function select(uid: string, e: MouseEvent) {
    activeUid = uid;
    if (e.shiftKey) app.selectRange(uid);
    else app.toggle(uid);
  }

  function rotateOne(uid: string, delta: number) {
    app.edit((pages) => model.rotatePages(pages, new Set([uid]), delta));
  }

  function deleteOne(uid: string) {
    const i = app.pages.findIndex((p) => p.uid === uid);
    app.edit((pages) => model.deletePages(pages, new Set([uid])));
    notify.announce(`Deleted page ${i + 1}. ${app.pages.length} left.`);
    void focusCard(app.pages[Math.min(i, app.pages.length - 1)]?.uid);
  }

  function keydown(e: KeyboardEvent, uid: string, index: number) {
    const mod = e.ctrlKey || e.metaKey;
    const pages = app.pages;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      // Move the selection if this page is part of it, otherwise just this page.
      const moving = app.selection.has(uid) ? app.selection : new Set([uid]);
      app.edit((p) => model.moveSelection(p, moving, delta));
      const at = app.pages.findIndex((p) => p.uid === uid);
      notify.announce(`Page moved to position ${at + 1} of ${app.pages.length}.`);
      void focusCard(uid);
      return;
    }
    let target = -1;
    switch (e.key) {
      case 'ArrowLeft':
        target = index - 1;
        break;
      case 'ArrowRight':
        target = index + 1;
        break;
      case 'ArrowUp':
        target = index - columns();
        break;
      case 'ArrowDown':
        target = index + columns();
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = pages.length - 1;
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (app.selection.size > 0) {
          const first = pages.findIndex((p) => app.selection.has(p.uid));
          const n = app.selection.size;
          app.edit((p) => model.deletePages(p, app.selection));
          notify.announce(`Deleted ${n} ${n === 1 ? 'page' : 'pages'}.`);
          void focusCard(app.pages[Math.min(first, app.pages.length - 1)]?.uid);
        } else deleteOne(uid);
        return;
      case 'Escape':
        if (app.selection.size) {
          e.preventDefault();
          app.select([]);
        }
        return;
      case 'a':
      case 'A':
        if (mod) {
          e.preventDefault();
          app.select(pages.map((p) => p.uid));
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    if (target >= 0 && target < pages.length) {
      void focusCard(pages[target].uid);
      if (e.shiftKey) app.selectRange(pages[target].uid);
    }
  }
</script>

<ul class="grid" bind:this={grid} aria-label="Pages. Use arrow keys to move between pages, Space to select, Alt+Arrow to reorder.">
  {#each app.pages as page, i (page.uid)}
    <PageCard
      {page}
      index={i}
      source={app.sources.get(page.sourceId)}
      selected={app.selection.has(page.uid)}
      active={page.uid === active}
      onselect={(e) => select(page.uid, e)}
      onpreview={() => onpreview(page.uid)}
      onrotate={(d) => rotateOne(page.uid, d)}
      ondelete={() => deleteOne(page.uid)}
      onkeydown={(e) => keydown(e, page.uid, i)}
      onfocus={() => (activeUid = page.uid)}
    />
  {/each}
</ul>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
    gap: 16px;
    margin: 0;
    padding: 20px 16px 24px;
    max-width: 1400px;
    margin-inline: auto;
  }
  @media (max-width: 720px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 12px 12px 24px;
    }
  }
</style>
