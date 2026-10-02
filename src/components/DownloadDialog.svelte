<script lang="ts">
  import { ExportJob, canShareFiles, type BuiltPdf } from '../lib/actions.svelte';
  import { levels, MARGINS, planFor } from '../lib/compression';
  import { marginPtFor } from '../lib/settings';
  import { settings } from '../lib/settings.svelte';
  import { defaultFileName } from '../lib/filenames';
  import { app } from '../lib/state.svelte';
  import type { CompressionLevel, ImageMargin, ImagePageSize } from '../lib/types';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

  type Props = { open: boolean; onclose: () => void; onpreview: (built: BuiltPdf) => void };
  let { open, onclose, onpreview }: Props = $props();

  const job = new ExportJob();
  let fileName = $state('');
  let level = $state<CompressionLevel>('lossless');
  let imagePageSize = $state<ImagePageSize>(settings.current.imageDefaultSize);
  let imageMargin = $state<ImageMargin>(settings.current.imageDefaultMargin);
  const levelList = $derived(levels(settings.current));

  // Choices are kept for the rest of the visit (so "Try another level" comes back to them). On each
  // open, only values the visitor hasn't changed follow new defaults: the file name follows the pages,
  // and the image options follow Settings.
  let wasOpen = false;
  let lastDefaultName = '';
  let lastDefaults = { size: settings.current.imageDefaultSize, margin: settings.current.imageDefaultMargin };
  /** On phones the less common options start folded away to keep the sheet short. */
  let moreOpen = $state(true);
  $effect(() => {
    if (open && !wasOpen) {
      const name = defaultFileName(app.usedSources());
      if (!fileName.trim() || fileName === lastDefaultName) fileName = name;
      lastDefaultName = name;
      const s = settings.current;
      if (s.imageDefaultSize !== lastDefaults.size) imagePageSize = s.imageDefaultSize;
      if (s.imageDefaultMargin !== lastDefaults.margin) imageMargin = s.imageDefaultMargin;
      lastDefaults = { size: s.imageDefaultSize, margin: s.imageDefaultMargin };
      moreOpen = !matchMedia('(max-width: 720px)').matches;
    }
    wasOpen = open;
  });

  const notices = $derived.by(() => {
    if (!open) return [];
    const used = app.usedSources();
    const out: string[] = [];
    const any = (k: 'wasEncrypted' | 'hasOutline' | 'hasForm' | 'isSigned') => used.some((s) => s.notices?.[k]);
    if (any('isSigned')) out.push('A file is digitally signed. Any change invalidates its signature.');
    if (any('wasEncrypted')) out.push('The downloaded copy will not be password-protected.');
    if (any('hasOutline')) out.push('Bookmarks are not carried over.');
    if (any('hasForm')) out.push('Form fields may stop working after a merge.');
    return out;
  });

  function exportOptions() {
    const s = settings.current;
    return { plan: planFor(level, s), imagePageSize, marginPt: marginPtFor(s, imageMargin), creditLine: s.creditLine };
  }

  async function download(e: SubmitEvent) {
    e.preventDefault();
    if (await job.run(fileName, level, exportOptions())) onclose();
  }

  /** Builds the PDF and shows it; Download or Share from there uses the same file. */
  async function preview() {
    const built = await job.build(fileName, level, exportOptions());
    if (!built) return;
    onclose();
    onpreview(built);
  }

  // Where the browser can't share files (some desktops), the button just says Preview.
  const previewLabel = canShareFiles() ? 'Preview & Share' : 'Preview';

  const pct = $derived(job.progress && job.progress.total > 0 ? Math.round((job.progress.done / job.progress.total) * 100) : 0);
</script>

<Dialog {open} title="Your PDF" sheet initialFocus=".top-action" dismissable={!job.running} onclose={() => !job.running && onclose()}>
  <form id="download-form" class="form" onsubmit={download}>
    <!-- The main action sits at the top so it is in reach on phones; progress shows here too. -->
    {#if job.running && job.progress}
      <div class="progress">
        <div class="bar" role="progressbar" aria-label="Building the PDF" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div class="fill" style:width="{pct}%"></div>
        </div>
        <p class="step" aria-live="polite">{job.progress.step}</p>
      </div>
    {:else}
      <button type="button" class="btn btn-filled top-action" onclick={preview}>
        <Icon name={previewLabel === 'Preview' ? 'preview' : 'share'} /> {previewLabel}
      </button>
    {/if}

    <label class="field">
      <span>File name</span>
      <input type="text" bind:value={fileName} disabled={job.running} spellcheck="false" autocomplete="off" enterkeyhint="done" />
    </label>

    <fieldset disabled={job.running}>
      <legend>Compression</legend>
      {#each levelList as l (l.id)}
        <label class="choice" class:checked={level === l.id}>
          <input type="radio" name="level" value={l.id} bind:group={level} />
          <span class="text">
            <span class="label">{l.label}{l.id === 'lossless' ? ' (default)' : ''}</span>
            <span class="hint">{l.hint}</span>
            {#if l.warning}<span class="warn"><Icon name="warning" size={16} /> {l.warning}</span>{/if}
          </span>
        </label>
      {/each}
    </fieldset>

    {#if app.hasImagePages || notices.length}
      <details class="more" bind:open={moreOpen}>
        <summary>More options{notices.length ? ` · ${notices.length} ${notices.length === 1 ? 'note' : 'notes'}` : ''}</summary>
        {#if app.hasImagePages}
          <fieldset disabled={job.running}>
            <legend>Image pages</legend>
            <div class="segmented" role="radiogroup" aria-label="Page size">
              <label class:checked={imagePageSize === 'A4'}><input type="radio" value="A4" bind:group={imagePageSize} />A4</label>
              <label class:checked={imagePageSize === 'original'}><input type="radio" value="original" bind:group={imagePageSize} />Original image size</label>
            </div>
            <div class="segmented" role="radiogroup" aria-label="Margin">
              <span class="seg-label">Margin</span>
              {#each MARGINS as m (m.id)}
                <label class:checked={imageMargin === m.id}><input type="radio" value={m.id} bind:group={imageMargin} />{m.label}</label>
              {/each}
            </div>
          </fieldset>
        {/if}

        {#if notices.length}
          <ul class="notices">
            {#each notices as n (n)}<li><Icon name="info" size={18} /> {n}</li>{/each}
          </ul>
        {/if}
      </details>
    {/if}
  </form>

  {#snippet actions()}
    {#if job.running}
      <button type="button" class="btn btn-outlined" onclick={() => job.cancel()}>Cancel</button>
    {:else}
      <button type="button" class="btn btn-text" onclick={onclose}>Close</button>
      <button type="submit" form="download-form" class="btn btn-outlined"><Icon name="download" /> Direct Download</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .top-action {
    width: 100%;
    min-height: 52px;
    font-size: 16px;
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
    font-weight: 400;
  }
  .field input:focus-visible {
    outline: 2px solid var(--mango-ink);
    outline-offset: 0;
    border-color: var(--mango-ink);
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 8px;
    font-weight: 600;
  }
  .choice {
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--outline);
    border-radius: var(--radius);
    background: var(--bg);
    cursor: pointer;
    transition: border-color var(--motion) var(--ease);
  }
  .choice.checked {
    border-color: var(--mango);
    box-shadow: inset 0 0 0 1px var(--mango);
  }
  .choice input {
    margin: 3px 0 0;
    width: 18px;
    height: 18px;
    accent-color: var(--mango-ink);
    flex: none;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .label {
    font-weight: 600;
  }
  .hint {
    color: var(--text-2);
  }
  .warn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--danger);
    font-weight: 500;
  }
  .segmented {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .seg-label {
    color: var(--text-2);
    margin-right: 4px;
  }
  .segmented label {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 0 16px;
    border: 1px solid #c9c8cc;
    border-radius: var(--pill);
    background: var(--bg);
    cursor: pointer;
  }
  .segmented label.checked {
    background: var(--mango-tint);
    border-color: var(--mango);
    font-weight: 600;
  }
  .segmented label:has(input:focus-visible) {
    outline: 2px solid var(--mango-ink);
    outline-offset: 2px;
  }
  .segmented input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .more {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .more summary {
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }
  .more summary::-webkit-details-marker {
    display: none;
  }
  .more summary::before {
    content: '▸';
    color: var(--mango-ink);
    transition: transform var(--motion) var(--ease);
  }
  .more[open] summary::before {
    transform: rotate(90deg);
  }
  .more[open] > :global(*:not(summary)) {
    margin-top: 12px;
  }
  .notices {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 12px;
    border-radius: var(--radius);
    background: var(--mango-tint);
    list-style: none;
  }
  .notices li {
    display: flex;
    gap: 8px;
    color: var(--mango-ink);
  }
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
