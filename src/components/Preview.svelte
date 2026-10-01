<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { renderLarge } from '../lib/thumbs';
  import IconButton from './IconButton.svelte';

  type Props = { uid: string | null; onclose: () => void; onnavigate: (uid: string) => void };
  let { uid, onclose, onnavigate }: Props = $props();

  let el: HTMLDialogElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let loading = $state(false);

  const index = $derived(uid ? app.pages.findIndex((p) => p.uid === uid) : -1);
  const page = $derived(index >= 0 ? app.pages[index] : null);
  const source = $derived(page ? app.sources.get(page.sourceId) : undefined);

  $effect(() => {
    if (!el) return;
    if (page && !el.open) el.showModal();
    else if (!page && el.open) el.close();
  });

  // Render the current page large enough for the screen (capped for memory).
  $effect(() => {
    if (!page || !canvas) return;
    const target = canvas;
    const width = Math.min(1800, Math.round(Math.min(window.innerWidth, 1100) * Math.min(2, devicePixelRatio || 1)));
    let stale = false;
    loading = true;
    renderLarge(page.sourceId, page.srcIndex, width)
      .then((bmp) => {
        if (stale) return bmp.close();
        target.width = bmp.width;
        target.height = bmp.height;
        target.getContext('2d')?.drawImage(bmp, 0, 0);
        bmp.close();
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) loading = false;
      });
    return () => (stale = true);
  });

  function go(delta: number) {
    const next = app.pages[index + delta];
    if (next) onnavigate(next.uid);
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  }

  const rotated = $derived(page ? page.addedRotation % 180 !== 0 : false);
</script>

<dialog
  bind:this={el}
  class="preview"
  aria-label={page ? `Preview of page ${index + 1} of ${app.pages.length}` : 'Preview'}
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
  onkeydown={keydown}
>
  {#if page}
    <div class="top">
      <span class="title">Page {index + 1} of {app.pages.length} · <span class="src">{source?.name}</span></span>
      <IconButton icon="close" label="Close preview" onclick={onclose} />
    </div>
    <div class="stage" class:loading>
      <canvas bind:this={canvas} class:rotated style:transform="rotate({page.addedRotation}deg)"></canvas>
    </div>
    <div class="nav">
      <IconButton icon="chevronLeft" label="Previous page" tipAbove disabled={index <= 0} onclick={() => go(-1)} />
      <IconButton icon="chevronRight" label="Next page" tipAbove disabled={index >= app.pages.length - 1} onclick={() => go(1)} />
    </div>
  {/if}
</dialog>

<style>
  .preview {
    width: 100vw;
    height: 100dvh;
    max-width: 100vw;
    max-height: 100dvh;
    margin: 0;
    padding: 0;
    border: 0;
    background: rgb(28 27 31 / 0.92);
    color: #fff;
  }
  .preview[open] {
    display: grid;
    grid-template-rows: auto 1fr auto;
  }
  .preview::backdrop {
    background: transparent;
  }
  .top,
  .nav {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
  }
  .nav {
    justify-content: center;
    padding-bottom: calc(12px + env(safe-area-inset-bottom));
  }
  .top :global(.icon-btn),
  .nav :global(.icon-btn) {
    color: #fff;
    background: rgb(255 255 255 / 0.12);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .src {
    font-weight: 400;
    opacity: 0.8;
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
    padding: 8px;
    overflow: hidden;
  }
  canvas {
    max-width: 100%;
    max-height: 100%;
    background: #fff;
    box-shadow: 0 4px 24px rgb(0 0 0 / 0.4);
    transition: transform var(--motion) var(--ease);
  }
  canvas.rotated {
    max-width: calc(100dvh - 140px);
    max-height: calc(100vw - 16px);
  }
  .loading canvas {
    opacity: 0.6;
  }
</style>
