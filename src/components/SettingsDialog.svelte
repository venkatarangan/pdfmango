<script lang="ts">
  import { CHOICES, CREDIT_MAX, DEFAULTS, cleanCredit, type Settings } from '../lib/settings';
  import { settings } from '../lib/settings.svelte';
  import { notify } from '../lib/notify.svelte';
  import Dialog from './Dialog.svelte';

  type Props = { open: boolean; onclose: () => void };
  let { open, onclose }: Props = $props();

  const s = $derived(settings.current);
  const mark = (v: number, d: number, unit: string) => `${v} ${unit}${v === d ? ' (default)' : ''}`;
  const mm = (pt: number) => `${Math.round((pt * 25.4) / 72)} mm`;
  const QUALITY_NAMES = ['Lower', 'Standard', 'Higher', 'Highest'];
  const qualityLabel = (list: readonly number[], v: number, d: number) => `${QUALITY_NAMES[list.indexOf(v)] ?? v}, JPEG ${v}${v === d ? ' (default)' : ''}`;

  // Credit line: the default, none, or the visitor's own text.
  type CreditMode = 'default' | 'none' | 'custom';
  const creditMode = $derived<CreditMode>(s.creditLine === DEFAULTS.creditLine ? 'default' : s.creditLine === '' ? 'none' : 'custom');
  let customText = $state('');
  $effect(() => {
    if (open && creditMode === 'custom') customText = s.creditLine;
  });

  function setCreditMode(mode: CreditMode) {
    if (mode === 'default') settings.update({ creditLine: DEFAULTS.creditLine });
    else if (mode === 'none') settings.update({ creditLine: '' });
    else settings.update({ creditLine: cleanCredit(customText) || 'Made with PDFMango' });
  }

  const num = (e: Event) => Number((e.currentTarget as HTMLSelectElement).value);
  const level = (k: 'balanced' | 'strong', patch: Partial<Settings['balanced']>) => settings.update({ [k]: { ...s[k], ...patch } });

  function reset() {
    settings.reset();
    customText = '';
    notify.show('Settings are back to their defaults.');
  }
</script>

<Dialog {open} title="Settings" sheet {onclose}>
  <div class="settings">
    <p class="lead">Choices here change the defaults for this browser only. They are saved on this device, and nothing about your files is ever stored.</p>

    <section>
      <h3>Downloaded files</h3>
      <fieldset>
        <legend>Credit in the PDF's document properties</legend>
        <label class="radio"><input type="radio" name="credit" checked={creditMode === 'default'} onchange={() => setCreditMode('default')} /> “{DEFAULTS.creditLine}” (default)</label>
        <label class="radio"><input type="radio" name="credit" checked={creditMode === 'none'} onchange={() => setCreditMode('none')} /> None</label>
        <label class="radio"><input type="radio" name="credit" checked={creditMode === 'custom'} onchange={() => setCreditMode('custom')} /> My own text</label>
        {#if creditMode === 'custom'}
          <input
            class="text"
            type="text"
            maxlength={CREDIT_MAX}
            bind:value={customText}
            onchange={() => settings.update({ creditLine: cleanCredit(customText) || DEFAULTS.creditLine })}
            aria-label="Your credit text"
          />
        {/if}
      </fieldset>
    </section>

    <section>
      <h3>Photos as pages</h3>
      <div class="grid">
        <label>
          <span>Page size</span>
          <select value={s.imageDefaultSize} onchange={(e) => settings.update({ imageDefaultSize: (e.currentTarget as HTMLSelectElement).value as Settings['imageDefaultSize'] })}>
            <option value="A4">A4{DEFAULTS.imageDefaultSize === 'A4' ? ' (default)' : ''}</option>
            <option value="original">Original image size{DEFAULTS.imageDefaultSize === 'original' ? ' (default)' : ''}</option>
          </select>
        </label>
        <label>
          <span>Margin</span>
          <select value={s.imageDefaultMargin} onchange={(e) => settings.update({ imageDefaultMargin: (e.currentTarget as HTMLSelectElement).value as Settings['imageDefaultMargin'] })}>
            {#each ['none', 'small', 'medium'] as const as m (m)}
              <option value={m}>{m[0].toUpperCase() + m.slice(1)}{DEFAULTS.imageDefaultMargin === m ? ' (default)' : ''}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Small margin</span>
          <select value={s.marginSmallPt} onchange={(e) => settings.update({ marginSmallPt: num(e) })}>
            {#each CHOICES.marginSmallPt as v (v)}<option value={v}>{mm(v)} · {mark(v, DEFAULTS.marginSmallPt, 'pt')}</option>{/each}
          </select>
        </label>
        <label>
          <span>Medium margin</span>
          <select value={s.marginMediumPt} onchange={(e) => settings.update({ marginMediumPt: num(e) })}>
            {#each CHOICES.marginMediumPt as v (v)}<option value={v}>{mm(v)} · {mark(v, DEFAULTS.marginMediumPt, 'pt')}</option>{/each}
          </select>
        </label>
      </div>
    </section>

    <section>
      <h3>Compression</h3>
      {#each [['balanced', 'Balanced'], ['strong', 'Strong']] as const as [k, name] (k)}
        <div class="level">
          <h4>{name}</h4>
          <div class="grid">
            <label>
              <span>Photo resolution</span>
              <select value={s[k].ppi} onchange={(e) => level(k, { ppi: num(e) })}>
                {#each CHOICES[`${k}Ppi`] as v (v)}<option value={v}>{mark(v, DEFAULTS[k].ppi, 'ppi')}</option>{/each}
              </select>
            </label>
            <label>
              <span>Photo quality</span>
              <select value={s[k].jpegQuality} onchange={(e) => level(k, { jpegQuality: num(e) })}>
                {#each CHOICES[`${k}Quality`] as v (v)}<option value={v}>{qualityLabel(CHOICES[`${k}Quality`], v, DEFAULTS[k].jpegQuality)}</option>{/each}
              </select>
            </label>
          </div>
          <label class="check">
            <input type="checkbox" checked={s[k].subsetFonts} onchange={(e) => level(k, { subsetFonts: (e.currentTarget as HTMLInputElement).checked })} />
            Keep only the characters each font uses (smaller files){DEFAULTS[k].subsetFonts ? ' (default: on)' : ''}
          </label>
        </div>
      {/each}
      <div class="level">
        <h4>Scan</h4>
        <div class="grid">
          <label>
            <span>Page resolution</span>
            <select value={s.scan.ppi} onchange={(e) => settings.update({ scan: { ...s.scan, ppi: num(e) } })}>
              {#each CHOICES.scanPpi as v (v)}<option value={v}>{mark(v, DEFAULTS.scan.ppi, 'ppi')}</option>{/each}
            </select>
          </label>
          <label>
            <span>Picture quality</span>
            <select value={s.scan.jpegQuality} onchange={(e) => settings.update({ scan: { ...s.scan, jpegQuality: num(e) } })}>
              {#each CHOICES.scanQuality as v (v)}<option value={v}>{qualityLabel(CHOICES.scanQuality, v, DEFAULTS.scan.jpegQuality)}</option>{/each}
            </select>
          </label>
        </div>
      </div>
    </section>

    <section>
      <h3>File size limits</h3>
      <div class="grid">
        <label>
          <span>On computers</span>
          <select value={s.desktopMaxMB} onchange={(e) => settings.update({ desktopMaxMB: num(e) })}>
            {#each CHOICES.desktopMaxMB as v (v)}<option value={v}>{mark(v, DEFAULTS.desktopMaxMB, 'MB')}</option>{/each}
          </select>
        </label>
        <label>
          <span>On phones and tablets</span>
          <select value={s.mobileMaxMB} onchange={(e) => settings.update({ mobileMaxMB: num(e) })}>
            {#each CHOICES.mobileMaxMB as v (v)}<option value={v}>{mark(v, DEFAULTS.mobileMaxMB, 'MB')}</option>{/each}
          </select>
        </label>
      </div>
      <p class="note">Total size of all files you add in one go. Higher limits can run out of memory on smaller devices.</p>
    </section>

    <section>
      <h3>Restricted PDFs</h3>
      <label class="check">
        <input type="checkbox" checked={s.respectOwnerRestrictions} onchange={(e) => settings.update({ respectOwnerRestrictions: (e.currentTarget as HTMLInputElement).checked })} />
        Respect authors who restrict page changes{DEFAULTS.respectOwnerRestrictions ? ' (default: on)' : ''}
      </label>
      <p class="note">When off, such PDFs open with a notice. Only edit documents you have the right to change.</p>
    </section>
  </div>

  {#snippet actions()}
    <button type="button" class="btn btn-text reset" onclick={reset} disabled={!settings.customized}>Reset all to defaults</button>
    <button type="button" class="btn btn-filled" onclick={onclose}>Done</button>
  {/snippet}
</Dialog>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .lead,
  .note {
    margin: 0;
    color: var(--text-2);
  }
  .note {
    margin-top: 8px;
    font-size: 13px;
  }
  section {
    padding-top: 16px;
    border-top: 1px solid var(--outline);
  }
  h3 {
    margin: 0 0 10px;
    font-size: 15px;
  }
  h4 {
    margin: 0 0 8px;
    font-size: 14px;
    color: var(--text-2);
  }
  .level + .level {
    margin-top: 14px;
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 6px;
    color: var(--text-2);
  }
  .radio,
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    cursor: pointer;
  }
  .radio input,
  .check input {
    width: 18px;
    height: 18px;
    flex: none;
    accent-color: var(--mango-ink);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  @media (max-width: 480px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 500;
  }
  select,
  .text {
    min-height: 44px;
    padding: 0 10px;
    border: 1px solid #c9c8cc;
    border-radius: 8px;
    background: var(--bg);
    font-weight: 400;
  }
  .text {
    margin: 4px 0 0 28px;
  }
  .reset {
    margin-right: auto;
  }
</style>
