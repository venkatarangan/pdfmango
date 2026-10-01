<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    open: boolean;
    title: string;
    onclose: () => void;
    /** When false, Esc and backdrop clicks do nothing (e.g. while a download is being built). */
    dismissable?: boolean;
    /** Phones show the dialog as a bottom sheet. */
    sheet?: boolean;
    /** Selector of the element to focus on open (default: the browser's choice, the first control). */
    initialFocus?: string;
    children: Snippet;
    actions?: Snippet;
  };
  let { open, title, onclose, dismissable = true, sheet = false, initialFocus, children, actions }: Props = $props();

  let el: HTMLDialogElement | undefined = $state();
  const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;

  $effect(() => {
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      if (initialFocus) el.querySelector<HTMLElement>(initialFocus)?.focus();
    } else if (!open && el.open) el.close();
  });
</script>

<dialog
  bind:this={el}
  class:sheet
  aria-labelledby={id}
  oncancel={(e) => {
    e.preventDefault();
    if (dismissable) onclose();
  }}
  onclick={(e) => {
    if (e.target === el && dismissable) onclose();
  }}
>
  <div class="inner">
    <h2 {id}>{title}</h2>
    {@render children()}
  </div>
  {#if actions}
    <div class="actions">{@render actions()}</div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--elev-3);
    overflow: auto;
    overscroll-behavior: contain;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    animation: pop var(--motion) var(--ease);
  }
  dialog::backdrop {
    background: var(--scrim);
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px 24px 8px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 24px 24px;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }
  @media (max-width: 720px) {
    dialog.sheet {
      width: 100%;
      max-width: 100%;
      margin: auto 0 0;
      max-height: 92dvh;
      border-radius: 20px 20px 0 0;
      padding-bottom: env(safe-area-inset-bottom);
    }
    dialog.sheet[open] {
      animation: rise 220ms var(--ease);
    }
    .inner {
      padding: 20px 16px 4px;
    }
    .actions {
      padding: 12px 16px 16px;
    }
    @keyframes rise {
      from {
        transform: translateY(40%);
        opacity: 0.6;
      }
    }
  }
</style>
