<script lang="ts">
  // One editor for splitting a page by hand and for checking the splits Split book spreads was
  // unsure about: drag the line onto the spine, choose the overlap, then Apply.
  import { app } from '../lib/state.svelte';
  import { renderLarge } from '../lib/thumbs';
  import { editOf } from '../lib/edits';
  import { guessSpine, splitPrefs, splitUi } from '../lib/actions.svelte';
  import { mergeSpread, resplit, splitPage, unsplit } from '../lib/split';
  import { notify } from '../lib/notify.svelte';
  import type { PageRef } from '../lib/types';

  let el: HTMLDialogElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let stageW = $state(0);
  let stageH = $state(0);
  let at = $state(0.5);
  let step = $state(0); // position in the review list
  let ready = $state(false);

  const target = $derived(splitUi.target);
  const reviewing = $derived(target?.mode === 'review');
  const ids = $derived(target?.mode === 'review' ? target.ids : []);
  const spreadId = $derived(reviewing ? ids[step] : undefined);

  /** The page being split, as it was before any split. */
  const whole = $derived.by((): PageRef | null => {
    if (!target) return null;
    if (target.mode === 'manual') return app.pages.find((p) => p.uid === target.uid) ?? null;
    const half = app.pages.find((p) => p.spread?.id === spreadId);
    return half ? unsplit(half) : null;
  });
  const source = $derived(whole ? app.sources.get(whole.sourceId) : undefined);
  const rot = $derived(whole?.addedRotation ?? 0);

  $effect(() => {
    if (!el) return;
    if (target && !el.open) {
      step = 0;
      el.showModal();
    } else if (!target && el.open) el.close();
  });

  // Where the line starts: the split being checked, or the worker's best guess.
  $effect(() => {
    if (!target) return;
    if (target.mode === 'review') {
      const half = app.pages.find((p) => p.spread?.id === spreadId);
      if (half?.spread) at = half.spread.at;
      return;
    }
    const p = app.pages.find((q) => q.uid === target.uid);
    at = 0.5;
    if (p) void guessSpine(p).then((g) => (at = g));
  });

  $effect(() => {
    if (!whole || !canvas) return;
    const target = canvas;
    ready = false;
    const width = Math.min(2000, Math.round(Math.min(window.innerWidth, 1400) * Math.min(2, devicePixelRatio || 1)));
    let stale = false;
    const e = editOf({ ...whole, crop: undefined });
    renderLarge(whole.sourceId, whole.srcIndex, width, e)
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

  // The page's size before rotation (corners change a photo's size, so ask the canvas once drawn).
  let drawn = $state<[number, number]>([1, 1]);
  $effect(() => {
    if (ready && canvas) drawn = [canvas.width, canvas.height];
  });
  const turned = $derived(rot % 180 !== 0);
  const fit = $derived.by(() => {
    const [w, h] = drawn;
    const s = Math.min(stageW / (turned ? h : w), stageH / (turned ? w : h)) || 0;
    return { w: w * s, h: h * s, sw: (turned ? h : w) * s, sh: (turned ? w : h) * s };
  });

  // ---- Dragging the line (on the page as it shows) ----
  let overlay: HTMLDivElement | undefined = $state();
  let dragging = $state(false);
  const clamp = (n: number) => Math.min(0.95, Math.max(0.05, n));
  function down(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    move(e);
  }
  function move(e: PointerEvent) {
    if (!dragging || !overlay) return;
    const r = overlay.getBoundingClientRect();
    at = clamp((e.clientX - r.left) / r.width);
  }
  function key(e: KeyboardEvent) {
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    at = clamp(at + d * (e.shiftKey ? 0.01 : 0.002));
  }

  const choice = $derived({ overlap: splitPrefs.overlap, rightFirst: splitPrefs.rightFirst });

  function next(message: string) {
    if (reviewing && step < ids.length - 1) {
      step++;
      return;
    }
    notify.announce(message);
    splitUi.target = null;
  }
  function apply() {
    if (!target) return;
    if (target.mode === 'manual') {
      const uid = target.uid;
      app.edit((pages) => pages.flatMap((p) => (p.uid === uid ? splitPage(p, at, choice) : [p])));
      notify.show('Split into two pages.');
      splitUi.target = null;
      return;
    }
    const id = spreadId!;
    app.edit((pages) => resplit(pages, id, at, choice));
    next('Splits checked.');
  }
  function skip() {
    next('Splits checked.');
  }
  function keepWhole() {
    const id = spreadId!;
    app.edit((pages) => mergeSpread(pages, id));
    next('Splits checked.');
  }
  function close() {
    splitUi.target = null;
  }

  const title = $derived(reviewing ? `Check split${ids.length > 1 ? ` · ${step + 1} of ${ids.length}` : ''}` : 'Split into two pages');
</script>

<dialog
  bind:this={el}
  class="editor split-editor"
  aria-labelledby="split-title"
  oncancel={(e) => {
    e.preventDefault();
    close();
  }}
>
  {#if target && whole}
    <div class="top">
      <h2 id="split-title">{title}</h2>
      <p class="hint">Drag the line onto the spine, between the two pages. {source?.kind === 'image' ? 'The photo is cut in two.' : 'On PDF pages the hidden half stays inside the file, as with any crop; the Scan level of compression removes it.'}</p>
    </div>
    <div class="stage" bind:clientWidth={stageW} bind:clientHeight={stageH}>
      <div class="wrap" style:width="{fit.w}px" style:height="{fit.h}px" style:transform="translate(-50%, -50%) rotate({rot}deg)">
        <canvas bind:this={canvas} class:ready></canvas>
      </div>
      <div class="overlay" bind:this={overlay} style:width="{fit.sw}px" style:height="{fit.sh}px">
        <div class="band" style:left="{(at - choice.overlap) * 100}%" style:width="{choice.overlap * 200}%"></div>
        <div
          role="slider"
          tabindex="0"
          class="line"
          class:active={dragging}
          style:left="{at * 100}%"
          aria-label="Split line (arrow keys move it)"
          aria-valuemin={5}
          aria-valuemax={95}
          aria-valuenow={Math.round(at * 100)}
          aria-valuetext="{Math.round(at * 100)}% across"
          onpointerdown={down}
          onpointermove={move}
          onpointerup={() => (dragging = false)}
          onpointercancel={() => (dragging = false)}
          onkeydown={key}
        ><span class="grip"></span></div>
        <span class="label left" aria-hidden="true">{choice.rightFirst ? 2 : 1}</span>
        <span class="label right" aria-hidden="true">{choice.rightFirst ? 1 : 2}</span>
      </div>
    </div>
    <div class="bar">
      <div class="opts">
        <label>
          Overlap
          <select bind:value={splitPrefs.overlap}>
            <option value={0}>None</option>
            <option value={0.01}>1% each side</option>
            <option value={0.02}>2% each side</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={splitPrefs.rightFirst} /> Right page first</label>
      </div>
      <div class="buttons">
        {#if reviewing}
          <button type="button" class="btn btn-text light" onclick={keepWhole}>Don't split this page</button>
          <button type="button" class="btn btn-text light" onclick={skip}>Skip</button>
        {:else}
          <button type="button" class="btn btn-text light" onclick={close}>Cancel</button>
        {/if}
        <button type="button" class="btn btn-filled" onclick={apply} disabled={!ready}>{reviewing ? 'Apply' : 'Split'}</button>
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
    margin: 20px 16px;
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
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    background: #fff;
    opacity: 0.4;
  }
  canvas.ready {
    opacity: 1;
  }
  .band {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgb(255 179 0 / 0.18);
    pointer-events: none;
  }
  .line {
    position: absolute;
    top: -12px;
    bottom: -12px;
    width: 44px;
    margin-left: -22px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: ew-resize;
    touch-action: none;
  }
  .line::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 21px;
    width: 2px;
    background: #ffb300;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
  }
  .grip {
    position: absolute;
    left: 8px;
    top: 50%;
    width: 28px;
    height: 44px;
    margin-top: -22px;
    border-radius: 14px;
    background: #ffb300;
    box-shadow:
      0 0 0 2px #fff,
      0 1px 4px rgb(0 0 0 / 0.5);
  }
  .line:focus-visible {
    outline: 2px solid #fff;
  }
  .label {
    position: absolute;
    top: 8px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgb(28 27 31 / 0.75);
    font-weight: 700;
    pointer-events: none;
  }
  .label.left {
    left: 8px;
  }
  .label.right {
    right: 8px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px 24px;
    padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px 16px;
  }
  .opts label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  select {
    min-height: 36px;
    border-radius: 8px;
    padding: 0 8px;
    font: inherit;
    color: #1c1b1f;
    background: #fff;
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
