<script lang="ts">
  // Straighten photo: drag four corners onto the corners of the sheet; Apply flattens it in the
  // worker. The photo is shown as it was added (with its added rotation), never already flattened.
  import { app } from '../lib/state.svelte';
  import { renderLarge } from '../lib/thumbs';
  import { DEFAULT_CORNERS, isUsableQuad, setCorners } from '../lib/edits';
  import { notify } from '../lib/notify.svelte';
  import type { PageRef, Point, Quad } from '../lib/types';

  type Props = { page: PageRef | null; onclose: () => void };
  let { page, onclose }: Props = $props();

  let el: HTMLDialogElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let stageW = $state(0);
  let stageH = $state(0);
  let quad = $state<Quad>(DEFAULT_CORNERS);
  let ready = $state(false);

  const source = $derived(page ? app.sources.get(page.sourceId) : undefined);
  const size = $derived(source?.pageSizes[0] ?? [1, 1]);
  const rot = $derived(page?.addedRotation ?? 0);

  $effect(() => {
    if (!el) return;
    if (page && !el.open) {
      quad = (page.corners ?? DEFAULT_CORNERS).map((p) => [...p]) as Quad;
      el.showModal();
    } else if (!page && el.open) el.close();
  });

  // The photo, upright, sharp enough for the screen.
  $effect(() => {
    if (!page || !canvas) return;
    const target = canvas;
    ready = false;
    const width = Math.min(2000, Math.round(Math.min(window.innerWidth, 1200) * Math.min(2, devicePixelRatio || 1)));
    let stale = false;
    renderLarge(page.sourceId, page.srcIndex, width)
      .then((bmp) => {
        if (stale) return bmp.close();
        target.width = bmp.width;
        target.height = bmp.height;
        target.getContext('2d')?.drawImage(bmp, 0, 0);
        bmp.close();
        ready = true;
      })
      .catch(() => {});
    return () => (stale = true);
  });

  // Fit the photo (turned by its added rotation) into the stage.
  const fit = $derived.by(() => {
    const [w, h] = size;
    const turned = rot % 180 !== 0;
    const s = Math.min(stageW / (turned ? h : w), stageH / (turned ? w : h)) || 0;
    return { w: w * s, h: h * s };
  });

  const usable = $derived(isUsableQuad(quad, size[0], size[1]));
  const outline = $derived(quad.map(([x, y]) => `${x},${y}`).join(' '));

  // ---- Dragging ----
  let wrap: HTMLDivElement | undefined = $state();
  let dragging = $state<number | null>(null);
  let loupe = $state<{ x: number; y: number } | null>(null);
  let loupeCanvas: HTMLCanvasElement | undefined = $state();

  /** Screen point -> 0..1 photo coordinates (undoing the added rotation). */
  function toPhoto(clientX: number, clientY: number): Point {
    const r = wrap!.getBoundingClientRect();
    const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
    const t = (-rot * Math.PI) / 180;
    const [dx, dy] = [clientX - cx, clientY - cy];
    const [ux, uy] = [dx * Math.cos(t) - dy * Math.sin(t), dx * Math.sin(t) + dy * Math.cos(t)];
    return [clamp(ux / fit.w + 0.5), clamp(uy / fit.h + 0.5)];
  }
  const clamp = (n: number) => Math.min(1, Math.max(0, n));

  function down(i: number, e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = i;
    move(e);
  }
  function move(e: PointerEvent) {
    if (dragging === null || !wrap) return;
    quad[dragging] = toPhoto(e.clientX, e.clientY);
    loupe = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null;
    if (loupe) drawLoupe();
  }
  function up() {
    dragging = null;
    loupe = null;
  }

  const LOUPE = 128;
  const ZOOM = 2.5;
  /** Magnifies the photo under the finger, which would otherwise hide the corner. */
  function drawLoupe() {
    const ctx = loupeCanvas?.getContext('2d');
    if (!ctx || !canvas || dragging === null) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    loupeCanvas!.width = loupeCanvas!.height = LOUPE * dpr;
    const [x, y] = quad[dragging];
    const perCss = canvas.width / fit.w; // canvas pixels per CSS pixel
    const half = (LOUPE / 2 / ZOOM) * perCss;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    ctx.translate(LOUPE / 2, LOUPE / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(canvas, x * canvas.width - half, y * canvas.height - half, half * 2, half * 2, -LOUPE / 2, -LOUPE / 2, LOUPE, LOUPE);
    ctx.restore();
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#ffb300';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2 - 12, LOUPE / 2);
    ctx.lineTo(LOUPE / 2 + 12, LOUPE / 2);
    ctx.moveTo(LOUPE / 2, LOUPE / 2 - 12);
    ctx.lineTo(LOUPE / 2, LOUPE / 2 + 12);
    ctx.stroke();
    ctx.restore();
  }

  /** Arrow keys move a focused corner (Shift for bigger steps), in the direction seen on screen. */
  function key(i: number, e: KeyboardEvent) {
    const px = e.shiftKey ? 12 : 2; // screen pixels per press
    const dirs: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const t = (-rot * Math.PI) / 180;
    const [ux, uy] = [d[0] * Math.cos(t) - d[1] * Math.sin(t), d[0] * Math.sin(t) + d[1] * Math.cos(t)];
    quad[i] = [clamp(quad[i][0] + (ux * px) / fit.w), clamp(quad[i][1] + (uy * px) / fit.h)];
  }

  function apply() {
    if (!page || !usable) return;
    app.edit((pages) => setCorners(pages, page!.uid, $state.snapshot(quad) as Quad));
    notify.announce('Photo straightened.');
    onclose();
  }
  function remove() {
    if (!page) return;
    app.edit((pages) => setCorners(pages, page!.uid, undefined));
    notify.announce('Photo put back as it was.');
    onclose();
  }

  const NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
</script>

<dialog
  bind:this={el}
  class="editor photo-editor"
  aria-labelledby="photo-title"
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
>
  {#if page}
    <div class="top">
      <h2 id="photo-title">Straighten photo</h2>
      <p class="hint">Drag the four corners onto the corners of the sheet, then press Apply.</p>
    </div>
    <div class="stage" bind:clientWidth={stageW} bind:clientHeight={stageH}>
      <div class="wrap" bind:this={wrap} style:width="{fit.w}px" style:height="{fit.h}px" style:transform="translate(-50%, -50%) rotate({rot}deg)">
        <canvas bind:this={canvas} class:ready></canvas>
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          <path class="shade" fill-rule="evenodd" d="M0 0H1V1H0Z M{outline.split(' ').join(' L')}Z" />
          <polygon class="edge" class:bad={!usable} points={outline} />
        </svg>
        {#each quad as [x, y], i (i)}
          <button
            type="button"
            class="handle"
            class:active={dragging === i}
            style:left="{x * 100}%"
            style:top="{y * 100}%"
            aria-label="Move the {NAMES[i]} corner (arrow keys)"
            onpointerdown={(e) => down(i, e)}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
            onkeydown={(e) => key(i, e)}
          ></button>
        {/each}
      </div>
    </div>
    {#if loupe}
      <canvas
        bind:this={loupeCanvas}
        class="loupe"
        aria-hidden="true"
        style:left="{Math.min(window.innerWidth - LOUPE - 8, Math.max(8, loupe.x - LOUPE / 2))}px"
        style:top="{Math.max(8, loupe.y - LOUPE - 48)}px"
      ></canvas>
    {/if}
    <div class="bar">
      {#if !usable}
        <p class="why" id="photo-why">The corners cross over or are too close together. Move them onto the corners of the sheet.</p>
      {/if}
      <div class="buttons">
        {#if page.corners}
          <button type="button" class="btn btn-text light" onclick={remove}>Remove</button>
        {/if}
        <button type="button" class="btn btn-text light" onclick={onclose}>Cancel</button>
        <button type="button" class="btn btn-filled" onclick={apply} disabled={!usable || !ready} aria-describedby={usable ? undefined : 'photo-why'}>Apply</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .editor {
    width: 100vw;
    height: 100dvh;
    max-width: 100vw;
    max-height: 100dvh;
    margin: 0;
    padding: 0;
    border: 0;
    background: #1c1b1f;
    color: #fff;
  }
  .editor[open] {
    display: grid;
    grid-template-rows: auto 1fr auto;
  }
  .editor::backdrop {
    background: transparent;
  }
  .top {
    padding: 12px 16px 4px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .hint {
    margin: 4px 0 0;
    opacity: 0.85;
    font-size: 14px;
  }
  .stage {
    position: relative;
    min-height: 0;
    margin: 28px;
    touch-action: none;
  }
  .wrap {
    position: absolute;
    left: 50%;
    top: 50%;
  }
  canvas:not(.loupe) {
    display: block;
    width: 100%;
    height: 100%;
    background: #fff;
    opacity: 0.4;
  }
  canvas.ready {
    opacity: 1;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .shade {
    fill: rgb(0 0 0 / 0.45);
  }
  .edge {
    fill: none;
    stroke: #ffb300;
    stroke-width: 2px;
    vector-effect: non-scaling-stroke;
  }
  .edge.bad {
    stroke: #ff8a80;
  }
  .handle {
    position: absolute;
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: grab;
    touch-action: none;
  }
  .handle::after {
    content: '';
    position: absolute;
    inset: 12px;
    border-radius: 50%;
    background: #ffb300;
    box-shadow:
      0 0 0 2px #fff,
      0 1px 4px rgb(0 0 0 / 0.5);
  }
  .handle.active {
    cursor: grabbing;
  }
  .handle:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 0;
  }
  .loupe {
    position: fixed;
    width: 128px;
    height: 128px;
    border-radius: 50%;
    border: 3px solid #fff;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
    pointer-events: none;
    z-index: 2;
  }
  .bar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
  }
  .why {
    margin: 0;
    color: #ffccbc;
    font-size: 14px;
    text-align: center;
  }
  .buttons {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .light {
    color: #fff;
  }
</style>
