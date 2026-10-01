import * as Comlink from 'comlink';
const t0 = performance.now();
const status = document.getElementById('status');
const log = [];
const note = (k, v) => { log.push([k, v]); status.textContent = log.map(([a, b]) => `${a}: ${b}`).join(' · '); };
const csp = [];
document.addEventListener('securitypolicyviolation', (e) => csp.push(`${e.violatedDirective} ${e.blockedURI}`));

// Start the engine after first paint, like the real app.
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const api = Comlink.wrap(worker);
const ready = new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))).then(async () => {
  const tStart = performance.now();
  const info = await api.init();
  note('engineReadyMs', Math.round(performance.now() - t0));
  return { ...info, initMs: performance.now() - tStart };
});

async function openAndRender(buf, { thumbWidthPx = 320, render = true } = {}) {
  await ready;
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const tOpen = performance.now();
  const info = await api.open(Comlink.transfer(buf, [buf]));
  const openMs = performance.now() - tOpen;
  const times = [];
  if (render) {
    const tR = performance.now();
    // Placeholders first (the grid), then thumbnails in order, as the lazy queue would for visible pages.
    const canvases = info.pageSizes.map(([w, h]) => { const c = document.createElement('canvas'); c.width = thumbWidthPx; c.height = Math.round((thumbWidthPx * h) / w); grid.append(c); return c; });
    for (let i = 0; i < info.pageCount; i++) {
      const bmp = await api.renderThumb(i, thumbWidthPx);
      canvases[i].getContext('bitmaprenderer').transferFromImageBitmap(bmp);
      times.push(performance.now() - tR);
    }
  }
  return { pageCount: info.pageCount, openMs, firstThumbMs: times[0], first12Ms: times[Math.min(11, times.length - 1)], allThumbsMs: times.at(-1), gridMs: openMs + (times.at(-1) ?? 0) };
}

window.spike = {
  ready,
  csp,
  async fetchFixture(name) { return (await fetch(`/fixtures/${name}`)).arrayBuffer(); },
  async run(name, opts) { return openAndRender(await this.fetchFixture(name), opts); },
  async compress(name, level) { await ready; const buf = await this.fetchFixture(name); return api.compress(Comlink.transfer(buf, [buf]), level); },
  async imagesToPdf(names) { await ready; const bufs = await Promise.all(names.map((n) => this.fetchFixture(n))); return api.imagesToPdf(Comlink.transfer(bufs, bufs)); },
};
document.getElementById('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = await openAndRender(await f.arrayBuffer());
  note('grid', `${r.pageCount} pages in ${Math.round(r.gridMs)} ms`);
});
