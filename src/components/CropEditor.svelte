<script lang="ts">
  // Crop: drag a rectangle over the page as it shows (after Straighten, Split and Straighten photo)
  // and keep only what is inside. The same crop can go on every selected page.
  import { app } from '../lib/state.svelte';
  import { renderLarge } from '../lib/thumbs';
  import { editOf, MIN_TRIM, setTrims } from '../lib/edits';
  import { shownToBase } from '../lib/split';
  import { notify } from '../lib/notify.svelte';
  import { plural } from '../lib/format';
  import type { Crop, PageRef, Rotation } from '../lib/types';

  type Props = { uid: string | null; onclose: () => void };
  let { uid, onclose }: Props = $props();

  let el: HTMLDialogElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let stageW = $state(0);
  let stageH = $state(0);
  let ready = $state(false);
  let drawn = $state<[number, number]>([1, 1]);
  /** The crop on the page as it shows (after its added rotation), 0..1. */
  let box = $state<Crop>({ x0: 0.04, y0: 0.04, x1: 0.96, y1: 0.96 });
  let all = $state(true);

  const page = $derived(uid ? (app.pages.find((p) => p.uid === uid) ?? null) : null);
  const rot = $derived((page?.addedRotation ?? 0) as Rotation);
  const inverse = (r: Rotation) => ((360 - r) % 360) as Rotation;
  // Other selected pages can take the same crop.
  const others = $derived(page && app.selection.has(page.uid) ? app.selection.size - 1 : 0);

  $effect(() => {
    if (!el) return;
    if (page && !el.open) {
      box = page.trim ? shownToBase(page.trim, inverse(rot)) : { x0: 0.04, y0: 0.04, x1: 0.96, y1: 0.96 };
      all = true;
      el.showModal();
    } else if (!page && el.open) el.close();
  });

  // The page with all its other edits, without its current crop.
  $effect(() => {
    if (!page || !canvas) return;
    const target = canvas;
    ready = false;
    const width = Math.min(2000, Math.round(Math.min(window.innerWidth, 1400) * Math.min(2, devicePixelRatio || 1)));
    let stale = false;
    const { trim: _, ...rest } = page;
    renderLarge(page.sourceId, page.srcIndex, width, editOf(rest as PageRef))
      .then((bmp) => {
        if (stale) return bmp.close();
        target.width = bmp.width;
        target.height = bmp.height;
        target.getContext('2d')?.drawImage(bmp, 0, 0);
        drawn = [bmp.width, bmp.height];
        bmp.close();
        ready = true;
      })
      .catch(() => {});
    return () => (stale = true);
  });

  const turned = $derived(rot % 180 !== 0);
  const fit = $derived.by(() => {
    const [w, h] = drawn;
    const s = Math.min(stageW / (turned ? h : w), stageH / (turned ? w : h)) || 0;
    return { w: w * s, h: h * s, sw: (turned ? h : w) * s, sh: (turned ? w : h) * s };
  });

  // ---- Dragging: a corner, an edge, or the whole box ----
  type Grip = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';
  let overlay: HTMLDivElement | undefined = $state();
  let grip = $state<Grip | null>(null);
  let start: { x: number; y: number; box: Crop } | null = null;
  let loupe = $state<{ x: number; y: number } | null>(null);
  let loupeCanvas: HTMLCanvasElement | undefined = $state();
  const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

  function point(e: PointerEvent) {
    const r = overlay!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  }
  function down(g: Grip, e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    grip = g;
    start = { ...point(e), box: { ...box } };
  }
  function move(e: PointerEvent) {
    if (!grip || !start || !overlay) return;
    const p = point(e);
    box = reshape(start.box, grip, p.x - start.x, p.y - start.y);
    loupe = e.pointerType === 'touch' && grip !== 'move' ? { x: e.clientX, y: e.clientY } : null;
    if (loupe) drawLoupe(p.x, p.y);
  }
  function up() {
    grip = null;
    start = null;
    loupe = null;
  }

  /** Moves the sides a grip holds by (dx, dy), keeping the box at least MIN_TRIM on each side. */
  function reshape(b: Crop, g: Grip, dx: number, dy: number): Crop {
    let { x0, y0, x1, y1 } = b;
    if (g === 'move') {
      const mx = clamp(dx, -x0, 1 - x1);
      const my = clamp(dy, -y0, 1 - y1);
      return { x0: x0 + mx, y0: y0 + my, x1: x1 + mx, y1: y1 + my };
    }
    if (g.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN_TRIM);
    if (g.includes('e')) x1 = clamp(x1 + dx, x0 + MIN_TRIM, 1);
    if (g.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN_TRIM);
    if (g.includes('s')) y1 = clamp(y1 + dy, y0 + MIN_TRIM, 1);
    return { x0, y0, x1, y1 };
  }

  /** Arrow keys move the focused grip (Shift for bigger steps). */
  function key(g: Grip, e: KeyboardEvent) {
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    e.stopPropagation();
    const px = e.shiftKey ? 12 : 2;
    box = reshape(box, g, (v[0] * px) / Math.max(1, fit.sw), (v[1] * px) / Math.max(1, fit.sh));
  }

  const LOUPE = 128;
  const ZOOM = 2.5;
  /** Magnifies the page under the finger, at (x, y) on the page as it shows. */
  function drawLoupe(x: number, y: number) {
    const ctx = loupeCanvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    loupeCanvas!.width = loupeCanvas!.height = LOUPE * dpr;
    const b = shownToBase({ x0: x, y0: y, x1: x, y1: y }, rot); // the same point on the canvas
    const perCss = canvas.width / Math.max(1, fit.w);
    const half = (LOUPE / 2 / ZOOM) * perCss;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    ctx.translate(LOUPE / 2, LOUPE / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(canvas, b.x0 * canvas.width - half, b.y0 * canvas.height - half, half * 2, half * 2, -LOUPE / 2, -LOUPE / 2, LOUPE, LOUPE);
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

  function targets(): Set<string> {
    if (!page) return new Set();
    return all && others > 0 ? new Set(app.selection) : new Set([page.uid]);
  }
  function apply() {
    if (!page) return;
    const shown = $state.snapshot(box) as Crop;
    const chosen = targets();
    // Each page gets the crop as it shows on screen, whatever its own added rotation.
    app.edit((pages) => setTrims(pages, chosen, (p) => shownToBase(shown, p.addedRotation)));
    notify.announce(chosen.size > 1 ? `Cropped ${plural(chosen.size, 'page')}.` : 'Page cropped.');
    onclose();
  }
  function remove() {
    if (!page) return;
    const chosen = targets();
    app.edit((pages) => setTrims(pages, chosen, null));
    notify.announce('Crop removed.');
    onclose();
  }

  const GRIPS: [Grip, string, number, number][] = [
    ['nw', 'top-left corner', 0, 0],
    ['n', 'top edge', 0.5, 0],
    ['ne', 'top-right corner', 1, 0],
    ['e', 'right edge', 1, 0.5],
    ['se', 'bottom-right corner', 1, 1],
    ['s', 'bottom edge', 0.5, 1],
    ['sw', 'bottom-left corner', 0, 1],
    ['w', 'left edge', 0, 0.5],
  ];
  const pct = (n: number) => `${n * 100}%`;
</script>

<dialog
  bind:this={el}
  class="editor crop-editor"
  aria-labelledby="crop-title"
  oncancel={(e) => {
    e.preventDefault();
    onclose();
  }}
>
  {#if page}
    <div class="top">
      <h2 id="crop-title">Crop</h2>
      <p class="hint">Drag the corners or edges to mark what to keep; drag inside the box to move it.</p>
    </div>
    <div class="stage" bind:clientWidth={stageW} bind:clientHeight={stageH}>
      <div class="wrap" style:width="{fit.w}px" style:height="{fit.h}px" style:transform="translate(-50%, -50%) rotate({rot}deg)">
        <canvas bind:this={canvas} class:ready></canvas>
      </div>
      <div class="overlay" bind:this={overlay} style:width="{fit.sw}px" style:height="{fit.sh}px">
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          <path class="shade" fill-rule="evenodd" d="M0 0H1V1H0Z M{box.x0} {box.y0}H{box.x1}V{box.y1}H{box.x0}Z" />
        </svg>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="box"
          class:moving={grip === 'move'}
          style:left={pct(box.x0)}
          style:top={pct(box.y0)}
          style:width={pct(box.x1 - box.x0)}
          style:height={pct(box.y1 - box.y0)}
          onpointerdown={(e) => down('move', e)}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
        ></div>
        {#each GRIPS as [g, name, fx, fy] (g)}
          <button
            type="button"
            class="grip {g.length === 1 ? 'edge' : 'corner'} g-{g}"
            style:left={pct(box.x0 + fx * (box.x1 - box.x0))}
            style:top={pct(box.y0 + fy * (box.y1 - box.y0))}
            aria-label="Move the {name} (arrow keys)"
            onpointerdown={(e) => down(g, e)}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
            onkeydown={(e) => key(g, e)}
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
      {#if others > 0}
        <label class="check"><input type="checkbox" bind:checked={all} /> Crop all {others + 1} selected pages the same way</label>
      {/if}
      <p class="note">{page.sourceId && app.sources.get(page.sourceId)?.kind === 'image' ? 'The photo is cut to the box.' : 'On PDF pages the part outside stays inside the file, as with any crop; the Scan level of compression removes it.'}</p>
      <div class="buttons">
        {#if page.trim}
          <button type="button" class="btn btn-text light" onclick={remove}>Remove crop</button>
        {/if}
        <button type="button" class="btn btn-text light" onclick={onclose}>Cancel</button>
        <button type="button" class="btn btn-filled" onclick={apply} disabled={!ready}>Apply</button>
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
    overflow: hidden;
  }
  .editor[open] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
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
  .hint,
  .note {
    margin: 4px 0 0;
    opacity: 0.85;
    font-size: 14px;
  }
  .note {
    margin: 0;
    text-align: center;
  }
  .stage {
    position: relative;
    min-height: 0;
    margin: 24px;
    touch-action: none;
  }
  .wrap,
  .overlay {
    position: absolute;
    left: 50%;
    top: 50%;
  }
  .overlay {
    transform: translate(-50%, -50%);
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
    fill: rgb(0 0 0 / 0.55);
  }
  .box {
    position: absolute;
    box-shadow: 0 0 0 2px #ffb300;
    cursor: move;
    touch-action: none;
  }
  .grip {
    position: absolute;
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px;
    padding: 0;
    border: 0;
    background: transparent;
    touch-action: none;
  }
  .grip::after {
    content: '';
    position: absolute;
    background: #ffb300;
    box-shadow:
      0 0 0 2px #fff,
      0 1px 4px rgb(0 0 0 / 0.5);
  }
  .corner::after {
    inset: 13px;
    border-radius: 50%;
  }
  .g-n::after,
  .g-s::after {
    left: 10px;
    right: 10px;
    top: 18px;
    bottom: 18px;
    border-radius: 4px;
  }
  .g-e::after,
  .g-w::after {
    top: 10px;
    bottom: 10px;
    left: 18px;
    right: 18px;
    border-radius: 4px;
  }
  .g-nw,
  .g-se {
    cursor: nwse-resize;
  }
  .g-ne,
  .g-sw {
    cursor: nesw-resize;
  }
  .g-n,
  .g-s {
    cursor: ns-resize;
  }
  .g-e,
  .g-w {
    cursor: ew-resize;
  }
  .grip:focus-visible {
    outline: 2px solid #fff;
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
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
  }
  .check input {
    width: 18px;
    height: 18px;
    accent-color: var(--mango);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .light {
    color: #fff;
  }
</style>
