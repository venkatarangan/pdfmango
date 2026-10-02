<script lang="ts">
  import { canShareFiles, resultMessage, saveBuilt, shareBuilt, type BuiltPdf } from '../lib/actions.svelte';
  import { Comlink, engine } from '../lib/engine';
  import { plural } from '../lib/format';
  import { renderLarge } from '../lib/thumbs';
  import type { PageSize } from '../lib/types';
  import { observeVisible } from '../lib/visible';
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';

  type Props = { built: BuiltPdf | null; onclose: () => void };
  let { built, onclose }: Props = $props();

  let el: HTMLDialogElement | undefined = $state();
  let sourceId = $state<string | null>(null);
  let pageSizes = $state<PageSize[]>([]);
  let failed = $state(false);
  const canShare = canShareFiles();

  // Open a copy of the finished PDF in the engine (the original stays here for download/share).
  $effect(() => {
    if (!built || !el) return;
    el.showModal();
    let id: string | null = null;
    let stale = false;
    failed = false;
    (async () => {
      try {
        const api = await engine();
        const copy = built.bytes.slice(0);
        const r = await api.open(Comlink.transfer(copy, [copy]), false);
        if (r.status !== 'ok') throw new Error(r.status);
        id = r.sourceId;
        if (stale) return void api.dispose(id);
        sourceId = id;
        pageSizes = r.pageSizes;
      } catch {
        if (!stale) failed = true;
      }
    })();
    return () => {
      stale = true;
      if (id) void engine().then((api) => api.dispose(id!));
      sourceId = null;
      pageSizes = [];
      if (el?.open) el.close();
    };
  });

  /** Renders a page while it is on screen and frees the pixels when it scrolls away. */
  function page(index: number) {
    return (canvas: HTMLCanvasElement) => {
      let gen = 0;
      const stop = observeVisible(canvas, (visible) => {
        const id = sourceId;
        const mine = ++gen;
        if (!visible || !id) {
          canvas.width = canvas.height = 0;
          return;
        }
        const width = Math.round(Math.min(900, canvas.parentElement?.clientWidth || 600) * Math.min(2, devicePixelRatio || 1));
        renderLarge(id, index, width)
          .then((bmp) => {
            if (mine !== gen) return bmp.close();
            canvas.width = bmp.width;
            canvas.height = bmp.height;
            canvas.getContext('2d')?.drawImage(bmp, 0, 0);
            bmp.close();
          })
          .catch(() => {});
      });
      return () => {
        gen++;
        stop();
      };
    };
  }

  function download() {
    if (!built) return;
    saveBuilt(built);
    onclose();
  }
</script>

<dialog
  bind:this={el}
  class="result"
  aria-label="Preview of the PDF to download"
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
>
  {#if built}
    <header>
      <div class="title">
        <strong>{built.name}</strong>
        <span>{plural(pageSizes.length, 'page')} · {resultMessage(built)}</span>
      </div>
      <IconButton icon="close" label="Back" onclick={onclose} />
    </header>

    <div class="pages">
      {#if failed}
        <p class="msg">This preview could not be shown, but the PDF is ready to download.</p>
      {:else}
        {#key sourceId}
          {#each pageSizes as [w, h], i (i)}
            <figure style:aspect-ratio="{w} / {h}">
              <canvas {@attach page(i)} aria-label="Page {i + 1}"></canvas>
              <figcaption>{i + 1}</figcaption>
            </figure>
          {/each}
        {/key}
      {/if}
    </div>

    <footer>
      <button type="button" class="btn btn-text" onclick={onclose}>Back</button>
      {#if canShare}
        <button type="button" class="btn btn-outlined" onclick={() => built && shareBuilt(built)}><Icon name="share" /> Share</button>
      {/if}
      <button type="button" class="btn btn-filled" onclick={download}><Icon name="download" /> Download</button>
    </footer>
  {/if}
</dialog>

<style>
  .result {
    width: min(960px, 100vw);
    height: 100dvh;
    max-width: 100vw;
    max-height: 100dvh;
    margin: 0 auto;
    padding: 0;
    border: 0;
    background: var(--surface);
    color: var(--text);
  }
  .result[open] {
    display: grid;
    grid-template-rows: auto 1fr auto;
  }
  .result::backdrop {
    background: var(--scrim);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 8px 16px;
    background: var(--bg);
  }
  header {
    border-bottom: 1px solid var(--outline);
  }
  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--outline);
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }
  .title {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .title strong,
  .title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title span {
    color: var(--text-2);
    font-size: 13px;
  }
  .pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 16px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  figure {
    position: relative;
    width: min(100%, 900px);
    margin: 0;
    background: #fff;
    box-shadow: var(--elev-2);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  figcaption {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 2px 8px;
    border-radius: var(--pill);
    background: rgb(28 27 31 / 0.7);
    color: #fff;
    font-size: 12px;
  }
  .msg {
    margin: 48px 16px;
    color: var(--text-2);
    text-align: center;
  }
  @media (max-width: 720px) {
    .pages {
      padding: 12px;
      gap: 12px;
    }
  }
</style>
