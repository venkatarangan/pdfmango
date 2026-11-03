<script lang="ts">
  // Options for Split book spreads, then the run itself (progress shows in BatchDialog).
  import { app } from '../lib/state.svelte';
  import { splitPrefs, splitSpreads } from '../lib/actions.svelte';
  import { plural } from '../lib/format';
  import Dialog from './Dialog.svelte';

  type Props = { open: boolean; onclose: () => void };
  let { open, onclose }: Props = $props();

  const count = $derived(app.selection.size);
  const scopeText = $derived(count ? `the ${plural(count, 'selected page')}` : `all ${plural(app.pages.length, 'page')}`);

  function run() {
    const uids = new Set(app.selection);
    onclose();
    void splitSpreads(uids, { overlap: splitPrefs.overlap, rightFirst: splitPrefs.rightFirst });
  }
</script>

<Dialog {open} title="Split book spreads" {onclose} sheet>
  <p class="lead">Splits each page that holds two facing pages of a book into two pages. Covers and single pages are left alone. Looks at {scopeText}.</p>
  <fieldset>
    <legend>Overlap</legend>
    <p class="note">Each half reaches past the spine, so letters near it aren't cut.</p>
    <div class="row">
      {#each [[0, 'None'], [0.01, '1%'], [0.02, '2%']] as [v, label] (v)}
        <label><input type="radio" name="split-overlap" value={v} bind:group={splitPrefs.overlap} /> {label}</label>
      {/each}
    </div>
  </fieldset>
  <label class="check"><input type="checkbox" bind:checked={splitPrefs.rightFirst} /> Right page first (books read right to left)</label>
  <p class="note">Splits that need a look get a <strong>Check split</strong> badge. On PDF pages the hidden half stays in the file, as with any crop; Scan compression removes it.</p>
  {#snippet actions()}
    <button type="button" class="btn btn-text" onclick={onclose}>Cancel</button>
    <button type="button" class="btn btn-filled" onclick={run}>Split</button>
  {/snippet}
</Dialog>

<style>
  .lead,
  .note {
    margin: 0;
    color: var(--text-2);
  }
  .note {
    font-size: 14px;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  legend {
    padding: 0;
    font-weight: 600;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
  }
  .row label,
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
  }
  input {
    width: 18px;
    height: 18px;
    accent-color: var(--mango);
  }
</style>
