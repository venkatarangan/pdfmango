<script lang="ts">
  import { canShareFiles, resultMessage, saveBuilt, shareBuilt, type BuiltPdf } from '../lib/actions.svelte';
  import { Comlink, engine } from '../lib/engine';
  import { emailVerdict, formatBytes, plural } from '../lib/format';
  import { isMobile, readDeviceEnv } from '../lib/limits';
  import { renderLarge } from '../lib/thumbs';
  import type { PageSize } from '../lib/types';
  import { observeVisible } from '../lib/visible';
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';

  type Props = { built: BuiltPdf | null; onclose: () => void; onretry: () => void };
  let { built, onclose, onretry }: Props = $props();

  let el: HTMLDialogElement | undefined = $state();
  let sourceId = $state<string | null>(null);
  let pageSizes = $state<PageSize[]>([]);
  let failed = $state(false);
  const canShare = canShareFiles();
  // On phones, sending the file on is usually the goal (and "Save to Files" is in the share sheet).
  const shareFirst = canShare && isMobile(readDeviceEnv());
  const verdict = $derived(built ? emailVerdict(built.outputSize) : null);

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
    <div class="size" class:warn={!verdict?.ok}>
      <span class="big">{formatBytes(built.outputSize)}</span>
      <span class="verdict">{verdict?.text}</span>
      <button type="button" class="btn btn-text retry" onclick={onretry}>Try another level</button>
    </div>

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
      <button type="button" class="btn {shareFirst ? 'btn-outlined' : 'btn-filled'}" onclick={download}><Icon name="download" /> Download</button>
      {#if canShare}
        <button type="button" class="btn {shareFirst ? 'btn-filled' : 'btn-outlined'}" onclick={() => built && shareBuilt(built)}><Icon name="share" /> Share</button>
      {/if}
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
    grid-template-rows: auto auto 1fr auto;
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
  .size {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 10px 16px;
    background: var(--bg);
    color: var(--text);
    border-bottom: 1px solid var(--outline);
  }
  .size.warn {
    background: var(--mango-tint);
    color: var(--mango-ink);
  }
  .big {
    font-size: 22px;
    font-weight: 700;
    line-height: 28px;
  }
  .verdict {
    flex: 1;
    min-width: 160px;
    font-weight: 500;
  }
  .retry {
    min-height: 40px;
    padding: 0 8px;
    margin-left: -8px;
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
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
