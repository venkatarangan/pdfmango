<script lang="ts">
  import { addFiles, startOver } from './lib/actions.svelte';
  import { ACCEPT } from './lib/filetypes';
  import { plural } from './lib/format';
  import { app } from './lib/state.svelte';
  import { notify } from './lib/notify.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import ResultPreview from './components/ResultPreview.svelte';
  import type { BuiltPdf } from './lib/actions.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import DownloadDialog from './components/DownloadDialog.svelte';
  import Icon from './components/Icon.svelte';
  import PageGrid from './components/PageGrid.svelte';
  import PasswordDialog from './components/PasswordDialog.svelte';
  import Preview from './components/Preview.svelte';
  import Snackbar from './components/Snackbar.svelte';
  import Toolbar from './components/Toolbar.svelte';

  let fileInput: HTMLInputElement | undefined = $state();
  let downloadOpen = $state(false);
  let downloadScope = $state<'all' | 'selected'>('all');
  let downloadMode = $state<'pdf' | 'images' | null>(null);
  function openExport(scope: 'all' | 'selected', mode: 'pdf' | 'images' | null) {
    downloadScope = scope;
    downloadMode = mode;
    downloadOpen = true;
  }
  let previewUid = $state<string | null>(null);
  let settingsOpen = $state(false);
  let built = $state.raw<BuiltPdf | null>(null);

  // The gear button lives in the static app bar (index.html), outside this component.
  $effect(() => {
    const btn = document.getElementById('settings-btn');
    const open = () => (settingsOpen = true);
    btn?.addEventListener('click', open);
    return () => btn?.removeEventListener('click', open);
  });
  let confirm = $state<null | { title: string; message: string; confirmLabel: string; run: () => void }>(null);

  const working = $derived(app.sources.size > 0 || app.loading > 0);

  function chooseFiles() {
    fileInput?.click();
  }

  function onPicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = ''; // picking the same file again must fire `change` again
    void addFiles(files);
  }

  function askStartOver() {
    confirm = {
      title: 'Start over?',
      message: 'This removes every page and file from PDFMango. Your original files are not affected.',
      confirmLabel: 'Start over',
      run: () => void startOver(),
    };
  }

  function askDeleteAll() {
    confirm = {
      title: `Delete all ${plural(app.pages.length, 'page')}?`,
      message: 'Nothing is selected, so this deletes every page. You can undo it.',
      confirmLabel: 'Delete all',
      run: () => {
        app.edit(() => []);
        notify.announce('Deleted all pages. Press Undo to bring them back.');
      },
    };
  }

  // ---- Drop anywhere on the window ----
  let dragDepth = $state(0);
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
  }
  function onDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = app.exporting ? 'none' : 'copy';
  }
  function onDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
  }
  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    if (app.exporting) return;
    void addFiles([...(e.dataTransfer?.files ?? [])]);
  }

  // ---- Keyboard shortcuts ----
  function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || app.exporting) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (app.undo()) notify.announce('Undone.');
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      if (app.redo()) notify.announce('Redone.');
    } else if (key === 'o') {
      e.preventDefault();
      chooseFiles();
    }
  }
</script>

<svelte:window ondragenter={onDragEnter} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop} onkeydown={onKeydown} />

<input bind:this={fileInput} class="visually-hidden" type="file" multiple accept={ACCEPT} tabindex="-1" aria-hidden="true" onchange={onPicked} />

{#if !working}
  <div class="empty-shell">
    <p class="lede"><a href="/about/">PDFMango</a> is a free, open-source PDF tool that works entirely in your browser. Merge, reorder, rotate and delete pages, turn photos into PDF pages, and shrink big files to email size.</p>
    <!-- The whole card opens the picker; the button is the keyboard and screen-reader route. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="dropcard" onclick={(e) => e.target === e.currentTarget && chooseFiles()}>
      <Icon name="upload" size={48} />
      <h1>Drop PDFs or images here</h1>
      <button type="button" class="btn btn-filled" onclick={chooseFiles}>Choose files</button>
    </div>
    <div class="intro">
      <p>Your files never leave your device: no upload, no sign-up, no ads, on Windows, Mac, Linux, Android and iPhone.</p>
      <p class="why">“Every PDF tool I tried was full of ads, cluttered, or wanted my documents on its server, so I had one built that is none of those.” — <a href="https://thefoundercatalyst.com/venkatarangan" rel="noopener">Venkatarangan Thirumalai</a></p>
    </div>
  </div>
{:else}
  <Toolbar
    onadd={chooseFiles}
    ondownload={() => openExport('all', null)}
    onextract={(mode) => openExport('selected', mode)}
    onstartover={askStartOver}
    ondeleteall={askDeleteAll}
  />
  {#if app.loading > 0}
    <div class="loading" role="status">
      <div class="indeterminate" aria-hidden="true"></div>
      <span>Opening {plural(app.loading, 'file')}…</span>
    </div>
  {/if}
  {#if app.pages.length > 0}
    <PageGrid onpreview={(uid) => (previewUid = uid)} />
  {:else if app.loading === 0}
    <div class="no-pages">
      <p>No pages left.</p>
      <div class="row">
        <button type="button" class="btn btn-outlined" onclick={() => app.undo()} disabled={!app.canUndo}><Icon name="undo" /> Undo</button>
        <button type="button" class="btn btn-filled" onclick={chooseFiles}><Icon name="add" /> Add files</button>
      </div>
    </div>
  {/if}
{/if}

{#if dragDepth > 0}
  <div class="drop-overlay" aria-hidden="true">
    <div class="drop-target"><Icon name="upload" size={48} /> Drop to add files</div>
  </div>
{/if}

<DownloadDialog open={downloadOpen} scope={downloadScope} startMode={downloadMode} onclose={() => (downloadOpen = false)} onpreview={(b) => (built = b)} />
<ResultPreview
  {built}
  onclose={() => (built = null)}
  onretry={() => {
    built = null;
    openExport(downloadScope, null); // same pages, last mode
  }}
/>
<SettingsDialog open={settingsOpen} onclose={() => (settingsOpen = false)} />
<PasswordDialog />
<Preview uid={previewUid} onclose={() => (previewUid = null)} onnavigate={(uid) => (previewUid = uid)} />
<ConfirmDialog
  open={!!confirm}
  title={confirm?.title ?? ''}
  message={confirm?.message ?? ''}
  confirmLabel={confirm?.confirmLabel ?? 'OK'}
  oncancel={() => (confirm = null)}
  onconfirm={() => {
    const run = confirm?.run;
    confirm = null;
    run?.();
  }}
/>
<Snackbar />

<style>
  .loading {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 1400px;
    margin: 12px auto 0;
    padding: 0 16px;
    color: var(--text-2);
  }
  .indeterminate {
    position: relative;
    width: 120px;
    height: 4px;
    border-radius: 2px;
    background: var(--outline);
    overflow: hidden;
  }
  .indeterminate::after {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 40%;
    background: var(--mango);
    animation: slide 1.1s var(--ease) infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(260%);
    }
  }
  .no-pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 64px 16px;
    color: var(--text-2);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .drop-overlay {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(255 243 224 / 0.85);
    pointer-events: none;
  }
  .drop-target {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px 64px;
    border: 3px dashed var(--mango);
    border-radius: 24px;
    background: var(--bg);
    color: var(--mango-ink);
    font-size: 18px;
    font-weight: 700;
  }
</style>
