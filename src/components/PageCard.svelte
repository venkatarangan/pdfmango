<script lang="ts">
  import type { PageRef } from '../lib/types';
  import type { SourceInfo } from '../lib/state.svelte';
  import { requestThumb } from '../lib/thumbs';
  import { observeVisible } from '../lib/visible';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';

  type Props = {
    page: PageRef;
    index: number;
    source: SourceInfo | undefined;
    selected: boolean;
    active: boolean;
    onselect: (e: MouseEvent) => void;
    onpreview: () => void;
    onrotate: (delta: number) => void;
    ondelete: () => void;
    onkeydown: (e: KeyboardEvent) => void;
    onfocus: () => void;
  };
  let { page, index, source, selected, active, onselect, onpreview, onrotate, ondelete, onkeydown, onfocus }: Props = $props();

  // Frame in which every thumbnail is fitted; A4 portrait fills it exactly.
  const FRAME_W = 160;
  const FRAME_H = 226;

  const pageSize = $derived(source?.pageSizes[page.srcIndex] ?? [595, 842]);
  const fit = $derived.by(() => {
    const [pw, ph] = pageSize;
    const [dw, dh] = page.addedRotation % 180 ? [ph, pw] : [pw, ph];
    const s = Math.min(FRAME_W / dw, FRAME_H / dh);
    return { w: ((pw * s) / FRAME_W) * 100, h: ((ph * s) / FRAME_H) * 100 };
  });

  // Turn the short way round when the rotation wraps (270 -> 0 animates +90, not -270).
  let turn = $state(0);
  let lastRotation: number | null = null;
  $effect.pre(() => {
    const r = page.addedRotation;
    if (lastRotation === null) turn = r;
    else turn += ((r - lastRotation + 540) % 360) - 180;
    lastRotation = r;
  });

  let canvas: HTMLCanvasElement | undefined = $state();
  let loaded = $state(false);

  function draw(bmp: ImageBitmap) {
    if (!canvas) return;
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')?.drawImage(bmp, 0, 0);
    loaded = true;
  }

  function thumbnail(node: HTMLElement) {
    let withdraw: (() => void) | null = null;
    const stop = observeVisible(node, (visible) => {
      if (visible && !withdraw) withdraw = requestThumb(page.sourceId, page.srcIndex, draw);
      else if (!visible && withdraw) {
        withdraw();
        withdraw = null;
      }
    });
    return () => {
      stop();
      withdraw?.();
    };
  }

  const n = $derived(index + 1);
  const name = $derived(source?.name ?? '');
  const label = $derived(
    `Page ${n}: ${name}${source && source.pageCount > 1 ? `, page ${page.srcIndex + 1}` : ''}${page.addedRotation ? `, rotated ${page.addedRotation}°` : ''}`,
  );

  // Double-tap on touch screens opens the preview (dblclick is unreliable there).
  let lastTap = 0;
  function pointerup(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    const now = performance.now();
    if (now - lastTap < 350) {
      lastTap = 0;
      onpreview();
    } else lastTap = now;
  }
</script>

<li class="card" class:selected data-uid={page.uid} {@attach thumbnail}>
  <div class="frame">
    <button
      type="button"
      class="hit"
      tabindex={active ? 0 : -1}
      aria-pressed={selected}
      aria-label={label}
      onclick={onselect}
      ondblclick={onpreview}
      onpointerup={pointerup}
      {onkeydown}
      {onfocus}
    >
      <canvas
        bind:this={canvas}
        class="thumb"
        class:loaded
        style:width="{fit.w}%"
        style:height="{fit.h}%"
        style:transform="translate(-50%, -50%) rotate({turn}deg)"
      ></canvas>
    </button>
    {#if selected}
      <span class="badge" aria-hidden="true"><Icon name="check" size={18} /></span>
    {/if}
    <div class="actions">
      <IconButton icon="rotateLeft" label="Rotate page {n} left" tabindex={active ? 0 : -1} onclick={() => onrotate(-90)} />
      <IconButton icon="rotateRight" label="Rotate page {n} right" tabindex={active ? 0 : -1} onclick={() => onrotate(90)} />
      <IconButton icon="delete" label="Delete page {n}" tabindex={active ? 0 : -1} onclick={ondelete} />
    </div>
  </div>
  <div class="meta">
    <span class="num">{n}</span>
    <span class="tag" title={name}>{name}</span>
  </div>
</li>

<style>
  .card {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 8px;
    border-radius: var(--radius);
    border: 1px solid var(--outline);
    background: var(--bg);
    transition:
      box-shadow var(--motion) var(--ease),
      border-color var(--motion) var(--ease);
    content-visibility: auto;
    contain-intrinsic-size: auto 280px;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  @media (hover: hover) {
    .card:hover {
      box-shadow: var(--elev-2);
    }
  }
  .card.selected {
    border-color: var(--mango);
    box-shadow: 0 0 0 1px var(--mango);
  }
  .frame {
    position: relative;
    aspect-ratio: 160 / 226;
    border-radius: 6px;
    background: var(--surface);
    overflow: hidden;
  }
  .hit {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: grab;
    touch-action: manipulation;
  }
  .hit:focus-visible {
    outline-offset: -2px;
  }
  .thumb {
    position: absolute;
    left: 50%;
    top: 50%;
    background: #fff;
    box-shadow: 0 0 0 1px var(--outline);
    transition: transform var(--motion) var(--ease);
  }
  .thumb:not(.loaded) {
    background: linear-gradient(110deg, #fff 30%, #f2f2f4 50%, #fff 70%) 0 0 / 300% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -150% 0;
    }
  }
  .badge {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--mango);
    color: var(--on-mango);
    box-shadow: var(--elev-1);
    pointer-events: none;
  }
  .actions {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: center;
    gap: 2px;
    padding: 4px;
    background: linear-gradient(to top, rgb(255 255 255 / 0.96) 70%, rgb(255 255 255 / 0));
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--motion) var(--ease);
  }
  .actions :global(.icon-btn) {
    background: #fff;
    box-shadow: var(--elev-1);
  }
  @media (hover: hover) {
    .card:hover .actions,
    .card:focus-within .actions {
      opacity: 1;
      pointer-events: auto;
    }
  }
  /* Touch screens: tapping selects a page and reveals its actions. */
  @media (hover: none) {
    .card.selected .actions {
      opacity: 1;
      pointer-events: auto;
    }
  }
  .meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    padding: 0 2px;
  }
  .num {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .tag {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
    font-size: 12px;
  }
  :global(.sortable-ghost) {
    opacity: 0.35;
  }
  :global(.sortable-chosen) .hit {
    cursor: grabbing;
  }
</style>
