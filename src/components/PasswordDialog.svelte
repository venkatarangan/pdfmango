<script lang="ts">
  import { prompts } from '../lib/actions.svelte';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

  let password = $state('');
  const req = $derived(prompts.password);

  $effect(() => {
    if (req) password = '';
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (password) req?.resolve(password);
  }
</script>

<Dialog open={!!req} title="Password needed" onclose={() => req?.resolve(null)}>
  <form id="password-form" class="form" onsubmit={submit}>
    <p class="lead"><Icon name="lock" size={20} /> <span><strong>{req?.fileName}</strong> is protected. Enter its password to open it.</span></p>
    <label class="field">
      <span>Password</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="password" bind:value={password} autocomplete="off" autofocus aria-invalid={req?.wrong} aria-describedby={req?.wrong ? 'pw-error' : undefined} />
    </label>
    {#if req?.wrong}<p id="pw-error" class="error" role="alert">That password is not right. Try again.</p>{/if}
    <p class="hint">The password stays on this device. The downloaded copy will not be password-protected.</p>
  </form>
  {#snippet actions()}
    <button type="button" class="btn btn-text" onclick={() => req?.resolve(null)}>Skip this file</button>
    <button type="submit" form="password-form" class="btn btn-filled" disabled={!password}>Open</button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lead {
    display: flex;
    gap: 8px;
    margin: 0;
    word-break: break-word;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 600;
  }
  .field input {
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid #c9c8cc;
    border-radius: 8px;
    background: var(--bg);
  }
  .field input[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-weight: 500;
  }
  .hint {
    margin: 0;
    color: var(--text-2);
  }
</style>
