<script lang="ts">
  import Dialog from './Dialog.svelte';

  type Props = { open: boolean; title: string; message: string; confirmLabel: string; onconfirm: () => void; oncancel: () => void };
  let { open, title, message, confirmLabel, onconfirm, oncancel }: Props = $props();
</script>

<Dialog {open} {title} onclose={oncancel}>
  <p class="msg">{message}</p>
  {#snippet actions()}
    <button type="button" class="btn btn-text" onclick={oncancel}>Cancel</button>
    <button type="button" class="btn btn-danger" onclick={onconfirm}>{confirmLabel}</button>
  {/snippet}
</Dialog>

<style>
  .msg {
    margin: 0;
    color: var(--text-2);
  }
</style>
