<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { renderLarge } from '../lib/thumbs';
  import { batch, setFineRotation, straightenPages } from '../lib/actions.svelte';
  import { cleanAngle, editOf } from '../lib/edits';
  import { config } from '../pdfmango.config';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import PhotoEditor from './PhotoEditor.svelte';

  type Props = { uid: string | null; onclose: () => void; onnavigate: (uid: string) => void };
  let { uid, onclose, onnavigate }: Props = $props();

  let el: HTMLDialogElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let loading = $state(false);

  const index = $derived(uid ? app.pages.findIndex((p) => p.uid === uid) : -1);
  const page = $derived(index >= 0 ? app.pages[index] : null);
  const source = $derived(page ? app.sources.get(page.sourceId) : undefined);
  const edit = $derived(page ? editOf(page) : undefined);
  const busy = $derived(app.exporting || batch.running);
  // Straighten photo works on photo pages that have not been split.
  const canFlatten = $derived(config.features.straightenPhoto && source?.kind === 'image' && !page?.crop);
  let photoOpen = $state(false);
  // Result of the last tool used here, shown under the page (cleared when the page changes).
  let status = $state('');
  let statusFor = '';
  $effect.pre(() => {
    if (uid !== statusFor) {
      statusFor = uid ?? '';
      status = '';
    }
  });
  async function straighten() {
    if (!page) return;
    status = await straightenPages(new Set([page.uid]), { quiet: true });
  }

  $effect(() => {
    if (!el) return;
    if (page && !el.open) el.showModal();
    else if (!page && el.open) el.close();
  });

  // Render the current page large enough for the screen (capped for memory). The last render is
  // kept, so the fine-rotate slider can turn it straight away while the worker draws the real one.
  let shown: { bmp: ImageBitmap; angle: number } | null = null;
  $effect(() => {
    if (!page || !canvas) return;
    const target = canvas;
    const angle = page.fineRotation ?? 0;
    const width = Math.min(1800, Math.round(Math.min(window.innerWidth, 1100) * Math.min(2, devicePixelRatio || 1)));
    let stale = false;
    loading = true;
    renderLarge(page.sourceId, page.srcIndex, width, edit)
      .then((bmp) => {
        if (stale) return bmp.close();
        target.width = bmp.width;
        target.height = bmp.height;
        target.getContext('2d')?.drawImage(bmp, 0, 0);
        shown?.bmp.close();
        shown = { bmp, angle };
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) loading = false;
      });
    return () => (stale = true);
  });
  $effect(() => {
    if (page) return;
    shown?.bmp.close();
    shown = null;
  });

  // ---- Fine rotation ----
  const range = config.straighten.sliderRange;
  let angle = $state(0);
  $effect.pre(() => {
    angle = page?.fineRotation ?? 0;
  });
  /** Turns the last render by the difference, on white, inside the page's own outline. */
  function drawTurned(value: number) {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas || !shown) return;
    const { width: w, height: h } = canvas;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(((value - shown.angle) * Math.PI) / 180);
    ctx.drawImage(shown.bmp, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  function slide(e: Event) {
    angle = Number((e.currentTarget as HTMLInputElement).value);
    drawTurned(angle);
  }
  function commit() {
    if (!page) return;
    setFineRotation(page.uid, angle);
    status = '';
  }
  function resetTurn() {
    if (!page) return;
    angle = 0;
    drawTurned(0);
    setFineRotation(page.uid, 0);
    status = '';
  }
  const angleText = $derived(`${cleanAngle(angle) > 0 ? '+' : ''}${cleanAngle(angle).toFixed(1)}°`);

  function go(delta: number) {
    const next = app.pages[index + delta];
    if (next) onnavigate(next.uid);
  }

  function keydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input')) return; // the slider uses the arrow keys
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
    {#if config.features.straighten || config.features.fineRotate || canFlatten}
      <div class="tools">
        {#if canFlatten}
          <button type="button" class="btn tool" onclick={() => (photoOpen = true)} disabled={busy}>
            <Icon name="straightenPhoto" /> Straighten photo
          </button>
        {/if}
        {#if config.features.straighten}
          <button type="button" class="btn tool" onclick={straighten} disabled={busy}>
            <Icon name="straighten" /> Straighten
          </button>
        {/if}
        {#if config.features.fineRotate}
          <div class="fine">
            <label for="fine-rotate">Fine rotate</label>
            <input
              id="fine-rotate"
              type="range"
              min={-range}
              max={range}
              step="0.1"
              value={angle}
              oninput={slide}
              onchange={commit}
              disabled={busy}
              aria-valuetext="{angleText}"
            />
            <output for="fine-rotate">{angleText}</output>
            <button type="button" class="btn tool small" onclick={resetTurn} disabled={busy || !page.fineRotation}>
              <Icon name="reset" /> Reset
            </button>
          </div>
        {/if}
      </div>
    {/if}
    {#if status}
      <p class="status" role="status">{status}</p>
    {/if}
    <div class="nav">
      <IconButton icon="chevronLeft" label="Previous page" tipAbove disabled={index <= 0} onclick={() => go(-1)} />
      <IconButton icon="chevronRight" label="Next page" tipAbove disabled={index >= app.pages.length - 1} onclick={() => go(1)} />
    </div>
  {/if}
</dialog>

<PhotoEditor page={photoOpen ? page : null} onclose={() => (photoOpen = false)} />

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
    grid-template-rows: auto 1fr auto auto auto;
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
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px 12px;
    padding: 4px 12px 0;
  }
  .tool {
    color: #fff;
    background: rgb(255 255 255 / 0.12);
    padding: 0 16px 0 12px;
  }
  .fine {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: center;
  }
  .fine label {
    font-weight: 600;
  }
  .fine input {
    width: min(260px, 50vw);
    accent-color: var(--mango);
  }
  .fine output {
    min-width: 4.5ch;
    font-variant-numeric: tabular-nums;
  }
  .tool.small {
    min-height: 36px;
    padding: 0 12px 0 8px;
  }
  .status {
    margin: 0;
    padding: 6px 16px 0;
    text-align: center;
    font-size: 14px;
    opacity: 0.9;
  }
  .tool:disabled {
    opacity: 0.5;
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
    max-width: calc(100dvh - 200px);
    max-height: calc(100vw - 16px);
  }
  .loading canvas {
    opacity: 0.6;
  }
</style>
