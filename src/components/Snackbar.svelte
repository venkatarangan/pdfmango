<script lang="ts">
  import { notify } from '../lib/notify.svelte';
  import IconButton from './IconButton.svelte';
</script>

{#if notify.snack}
  {#key notify.snack.id}
    <div class="snack" class:error={notify.snack.tone === 'error'}>
      <span class="text">{notify.snack.text}</span>
      {#if notify.snack.action}
        <button
          type="button"
          class="act"
          onclick={() => {
            const run = notify.snack?.action?.run;
            notify.dismiss();
            run?.();
          }}>{notify.snack.action.label}</button
        >
      {/if}
      <IconButton icon="close" label="Dismiss" onclick={() => notify.dismiss()} tipAbove tipEnd />
    </div>
  {/key}
{/if}

<!-- Screen readers hear results, errors and edits here. -->
<div class="visually-hidden" aria-live="polite" aria-atomic="true">{notify.live}</div>

<style>
  .snack {
    position: fixed;
    left: 50%;
    bottom: 24px;
    z-index: 70;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    max-width: min(640px, calc(100vw - 32px));
    min-height: 48px;
    padding: 4px 4px 4px 16px;
    border-radius: 8px;
    background: var(--snack-bg);
    color: #fff;
    box-shadow: var(--elev-3);
    animation: in 200ms var(--ease);
  }
  .snack.error {
    border-left: 4px solid #ff8a80;
  }
  .text {
    padding: 8px 0;
  }
  .act {
    flex: none;
    min-height: 40px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--mango);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .act:hover {
    background: rgb(255 255 255 / 0.08);
  }
  .snack :global(.icon-btn) {
    color: #fff;
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }
  @media (max-width: 720px) {
    .snack {
      bottom: calc(72px + env(safe-area-inset-bottom));
    }
  }
</style>
