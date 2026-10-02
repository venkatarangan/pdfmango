<script lang="ts">
  import { ExportJob, ImageJob, canShareFiles, canShareImages, saveImages, shareImages, type BuiltImages, type BuiltPdf } from '../lib/actions.svelte';
  import { levels, MARGINS, planFor } from '../lib/compression';
  import { config } from '../pdfmango.config';
  import { marginPtFor } from '../lib/settings';
  import { settings } from '../lib/settings.svelte';
  import { defaultFileName, defaultImageBase, finalImageBase, pageImageName } from '../lib/filenames';
  import { formatBytes, plural } from '../lib/format';
  import { isMobile, readDeviceEnv } from '../lib/limits';
  import { IMAGE_FORMATS, MAX_IMAGES_ON_PHONES, PHONE_LIMIT_MESSAGE, dpiLabel } from '../lib/page-images';
  import { app } from '../lib/state.svelte';
  import type { CompressionLevel, ImageFormat, ImageMargin, ImagePageSize } from '../lib/types';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

  type Props = {
    open: boolean;
    /** 'all' saves every page (the main Save button); 'selected' saves only the selection (Extract). */
    scope: 'all' | 'selected';
    /** Mode to open in; null keeps the last one used during this visit. */
    startMode: 'pdf' | 'images' | null;
    onclose: () => void;
    onpreview: (built: BuiltPdf) => void;
  };
  let { open, scope, startMode, onclose, onpreview }: Props = $props();

  const job = new ExportJob();
  const imageJob = new ImageJob();
  const running = $derived(job.running || imageJob.running);
  const phone = isMobile(readDeviceEnv());

  let mode = $state<'pdf' | 'images'>('pdf');
  let fileName = $state('');
  let docTitle = $state('');
  let level = $state<CompressionLevel>('lossless');
  let imagePageSize = $state<ImagePageSize>(settings.current.imageDefaultSize);
  let imageMargin = $state<ImageMargin>(settings.current.imageDefaultMargin);
  let imageBase = $state('');
  let imageFormat = $state<ImageFormat>(settings.current.imageExportFormat);
  let imageDpi = $state(settings.current.imageExportDpi);
  /** Images made by the last Save; cleared whenever a choice changes. */
  let images = $state.raw<BuiltImages | null>(null);
  const levelList = $derived(levels(settings.current));

  const selectedOnly = $derived(scope === 'selected' && app.selection.size > 0);
  const chosen = $derived(selectedOnly ? app.pages.filter((p) => app.selection.has(p.uid)) : app.pages);
  // Phones share at most MAX_IMAGES_ON_PHONES images at a time; computers have no limit.
  const imagesBlocked = $derived(phone && chosen.length > MAX_IMAGES_ON_PHONES);
  const title = $derived(selectedOnly ? `Selected pages as ${mode === 'pdf' ? 'PDF' : 'images'}` : mode === 'pdf' ? 'Your PDF' : 'Your images');
  const scopeLine = $derived(selectedOnly ? `The ${plural(chosen.length, 'selected page')}` : chosen.length === 1 ? 'Your page' : `All ${chosen.length} pages`);

  function setMode(m: 'pdf' | 'images') {
    if (m === 'images' && imagesBlocked) return;
    mode = m;
  }

  // Choices are kept for the rest of the visit (so "Try another level" comes back to them). On each
  // open, only values the visitor hasn't changed follow new defaults: the file name follows the pages,
  // and the image options follow Settings.
  let wasOpen = false;
  let lastDefaultName = '';
  let lastDefaultBase = '';
  let lastDefaults = {
    size: settings.current.imageDefaultSize,
    margin: settings.current.imageDefaultMargin,
    format: settings.current.imageExportFormat,
    dpi: settings.current.imageExportDpi,
  };
  /** On phones the less common options start folded away to keep the sheet short. */
  let moreOpen = $state(true);
  $effect(() => {
    if (open && !wasOpen) {
      const used = app.usedSources(chosen);
      const whole = defaultFileName(used);
      const name = selectedOnly ? whole.replace(/(-edited)?\.pdf$/, '-selected.pdf') : whole;
      if (!fileName.trim() || fileName === lastDefaultName) fileName = name;
      lastDefaultName = name;
      const base = defaultImageBase(used);
      if (!imageBase.trim() || imageBase === lastDefaultBase) imageBase = base;
      lastDefaultBase = base;
      const s = settings.current;
      if (s.imageDefaultSize !== lastDefaults.size) imagePageSize = s.imageDefaultSize;
      if (s.imageDefaultMargin !== lastDefaults.margin) imageMargin = s.imageDefaultMargin;
      if (s.imageExportFormat !== lastDefaults.format) imageFormat = s.imageExportFormat;
      if (s.imageExportDpi !== lastDefaults.dpi) imageDpi = s.imageExportDpi;
      lastDefaults = { size: s.imageDefaultSize, margin: s.imageDefaultMargin, format: s.imageExportFormat, dpi: s.imageExportDpi };
      moreOpen = !matchMedia('(max-width: 720px)').matches;
      const want = startMode ?? mode;
      mode = want === 'images' && !imagesBlocked ? 'images' : 'pdf';
      images = null;
    }
    wasOpen = open;
  });

  // Any change to what would be saved makes the ready images stale.
  $effect(() => {
    void [mode, chosen, imageFormat, imageDpi, imageBase];
    images = null;
  });

  const notices = $derived.by(() => {
    if (!open) return [];
    const used = app.usedSources(chosen);
    const out: string[] = [];
    const any = (k: 'wasEncrypted' | 'hasOutline' | 'hasForm' | 'isSigned') => used.some((s) => s.notices?.[k]);
    if (any('isSigned')) out.push('A file is digitally signed. Any change invalidates its signature.');
    if (any('wasEncrypted')) out.push('The downloaded copy will not be password-protected.');
    if (any('hasOutline')) out.push('Bookmarks are not carried over.');
    if (any('hasForm')) out.push('Form fields may stop working after a merge.');
    return out;
  });
  const hasImagePages = $derived(chosen.some((p) => app.sources.get(p.sourceId)?.kind === 'image'));

  /** Printable text only, single line. */
  const cleanTitle = (t: string) => t.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

  function exportOptions() {
    const s = settings.current;
    return { plan: planFor(level, s), imagePageSize, marginPt: marginPtFor(s, imageMargin), creditLine: s.creditLine, title: cleanTitle(docTitle) };
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (mode === 'images') return void saveAsImages();
    if (await job.run(fileName, level, exportOptions(), chosen)) onclose();
  }

  /** Builds the PDF and shows it; Download or Share from there uses the same file. */
  async function preview() {
    const built = await job.build(fileName, level, exportOptions(), chosen);
    if (!built) return;
    onclose();
    onpreview(built);
  }

  async function saveAsImages() {
    const base = finalImageBase(imageBase, defaultImageBase(app.usedSources(chosen)));
    const opts = { dpi: imageDpi, format: imageFormat, jpegQuality: config.imageExport.jpegQuality, maxPixels: config.imageExport.maxPixels };
    images = await imageJob.build(base, chosen, opts);
  }

  function cancel() {
    if (job.running) void job.cancel();
    else imageJob.cancel();
  }

  // Where the browser can't share files (some desktops), the button just says Preview.
  const previewLabel = canShareFiles() ? 'Preview & Share' : 'Preview';
  const shareable = $derived(images ? canShareImages(images) : false);
  const shareFirst = $derived(shareable && phone);

  const progress = $derived(job.progress ?? imageJob.progress);
  const pct = $derived(progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0);
  const pagesWord = $derived(plural(chosen.length, 'page'));
  // The first file's real name: page numbers are positions in the full list, so a selection may start at p07.
  const sampleName = $derived(
    pageImageName(finalImageBase(imageBase, 'pages'), chosen.length ? app.pages.indexOf(chosen[0]) + 1 : 1, app.pages.length, 'png').replace(/\.png$/, ''),
  );
</script>

<Dialog {open} {title} sheet initialFocus=".top-action" dismissable={!running} onclose={() => !running && onclose()}>
  <form id="download-form" class="form" onsubmit={submit}>
    <div class="segmented modes" role="radiogroup" aria-label="Save as">
      <label class:checked={mode === 'pdf'}>
        <input type="radio" name="mode" value="pdf" checked={mode === 'pdf'} disabled={running} onchange={() => setMode('pdf')} /><Icon name="pdf" size={20} /> PDF
      </label>
      <label class:checked={mode === 'images'} class:disabled={imagesBlocked} title={imagesBlocked ? PHONE_LIMIT_MESSAGE : undefined}>
        <input type="radio" name="mode" value="images" checked={mode === 'images'} disabled={running || imagesBlocked} aria-describedby={imagesBlocked ? 'images-limit' : undefined} onchange={() => setMode('images')} /><Icon name="image" size={20} /> Images
      </label>
    </div>
    <p class="scope">{scopeLine}</p>
    {#if imagesBlocked}
      <p class="limit" id="images-limit"><Icon name="info" size={18} /> {PHONE_LIMIT_MESSAGE}</p>
    {/if}

    <!-- The main action sits at the top so it is in reach on phones; progress shows here too. -->
    {#if running && progress}
      <div class="progress">
        <div class="bar" role="progressbar" aria-label={mode === 'pdf' ? 'Building the PDF' : 'Saving pages as images'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div class="fill" style:width="{pct}%"></div>
        </div>
        <p class="step" aria-live="polite">{progress.step}</p>
      </div>
    {:else if mode === 'pdf'}
      <button type="button" class="btn btn-filled top-action" onclick={preview}>
        <Icon name={previewLabel === 'Preview' ? 'preview' : 'share'} /> {previewLabel}
      </button>
    {:else if images}
      <div class="ready" role="status">
        <p><strong>{plural(images.files.length, 'image')} ready</strong> · {formatBytes(images.totalBytes)}</p>
        <div class="ready-actions">
          {#if shareable}
            <button type="button" class="btn {shareFirst ? 'btn-filled' : 'btn-outlined'} top-action" onclick={() => images && shareImages(images)}>
              <Icon name="share" /> {images.files.length === 1 ? 'Share image' : `Share ${images.files.length} images`}
            </button>
          {/if}
          <button type="button" class="btn {shareFirst ? 'btn-outlined' : 'btn-filled'} {shareable ? '' : 'top-action'}" onclick={() => images && saveImages(images)}>
            <Icon name="download" /> {images.files.length === 1 ? 'Download image' : 'Download as ZIP'}
          </button>
        </div>
      </div>
    {:else}
      <button type="submit" class="btn btn-filled top-action"><Icon name="image" /> Save {chosen.length === 1 ? '1 page as an image' : `${pagesWord} as images`}</button>
    {/if}

    {#if mode === 'pdf'}
      <label class="field">
        <span>File name</span>
        <input type="text" bind:value={fileName} disabled={running} spellcheck="false" autocomplete="off" enterkeyhint="done" />
      </label>

      <fieldset disabled={running}>
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

      <details class="more" bind:open={moreOpen}>
        <summary>More options{notices.length ? ` · ${notices.length} ${notices.length === 1 ? 'note' : 'notes'}` : ''}</summary>
        <label class="field">
          <span>Document title <span class="optional">(optional)</span></span>
          <input type="text" bind:value={docTitle} disabled={running} maxlength="200" autocomplete="off" enterkeyhint="done" />
        </label>

        {#if hasImagePages}
          <fieldset disabled={running}>
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
    {:else}
      <label class="field">
        <span>File names</span>
        <input type="text" bind:value={imageBase} disabled={running} spellcheck="false" autocomplete="off" enterkeyhint="done" aria-describedby="image-names" />
        <span class="hint" id="image-names">Saved as {sampleName}.png, and so on{chosen.length > 1 ? (phone ? '' : ', in one ZIP') : ''}.</span>
      </label>

      <fieldset disabled={running}>
        <legend>Format</legend>
        <div class="segmented" role="radiogroup" aria-label="Format">
          {#each IMAGE_FORMATS as f (f.id)}
            <label class:checked={imageFormat === f.id}><input type="radio" value={f.id} bind:group={imageFormat} />{f.label}</label>
          {/each}
        </div>
        <p class="hint">
          {imageFormat === 'auto' ? 'PNG for text and drawings, JPG for photos, page by page.' : imageFormat === 'png' ? 'Sharpest for text; photos make big files.' : 'Smallest files; text edges are slightly soft.'}
        </p>
      </fieldset>

      <fieldset disabled={running}>
        <legend>Resolution</legend>
        <div class="segmented" role="radiogroup" aria-label="Resolution">
          {#each Object.values(config.imageExport.dpiChoices) as d (d)}
            <label class:checked={imageDpi === d}><input type="radio" value={d} bind:group={imageDpi} />{dpiLabel(d)}</label>
          {/each}
        </div>
      </fieldset>
    {/if}
  </form>

  {#snippet actions()}
    {#if running}
      <button type="button" class="btn btn-outlined" onclick={cancel}>Cancel</button>
    {:else}
      <button type="button" class="btn btn-text" onclick={onclose}>Close</button>
      {#if mode === 'pdf'}
        <button type="submit" form="download-form" class="btn btn-outlined"><Icon name="download" /> Direct Download</button>
      {/if}
    {/if}
  {/snippet}
</Dialog>

<style>
  .modes label {
    gap: 6px;
    flex: 1;
    justify-content: center;
  }
  .segmented label.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .limit {
    display: flex;
    gap: 8px;
    margin: -8px 0 0;
    color: var(--text-2);
  }
  .scope {
    margin: -8px 0 0;
    color: var(--text-2);
    font-weight: 600;
  }
  .optional {
    color: var(--text-2);
    font-weight: 400;
  }
  .field .hint,
  fieldset .hint {
    margin: 0;
    font-weight: 400;
  }
  .ready {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius);
    background: var(--mango-tint);
  }
  .ready p {
    margin: 0;
  }
  .ready-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .ready-actions .btn {
    flex: 1 1 200px;
    min-height: 48px;
  }
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
