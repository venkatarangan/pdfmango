<script lang="ts">
  import { batch } from '../lib/actions.svelte';
  import Dialog from './Dialog.svelte';

  // Short jobs finish before the window would show, so it only appears after a moment.
  let show = $state(false);
  $effect(() => {
    if (!batch.running) {
      show = false;
      return;
    }
    const t = setTimeout(() => (show = true), 400);
    return () => clearTimeout(t);
  });

  const p = $derived(batch.progress);
  const pct = $derived(p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0);
</script>

<Dialog open={show && batch.running} title={batch.title} dismissable={false} onclose={() => {}}>
  <div class="progress">
    <div class="bar" role="progressbar" aria-label={batch.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div class="fill" style:width="{pct}%"></div>
    </div>
    <p class="step" aria-live="polite">{p?.step ?? ''}</p>
  </div>
  {#snippet actions()}
    <button type="button" class="btn btn-text" onclick={() => batch.cancel()}>Cancel</button>
  {/snippet}
</Dialog>

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--outline);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--mango);
    transition: width 120ms linear;
  }
  .step {
    margin: 0;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
</style>
