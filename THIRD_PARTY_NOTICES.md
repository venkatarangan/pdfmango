# Third-party notices

PDFMango is licensed under the GNU Affero General Public License v3.0 or later. It includes or is built with the open-source software below. Every licence listed is compatible with the AGPL-3.0.

## Shipped to the browser

These are bundled into the files served at pdf.mangoidiots.com.

| Package | Version | Licence | Copyright / author | Use |
| --- | --- | --- | --- | --- |
| [mupdf](https://github.com/ArtifexSoftware/mupdf.js) (MuPDF.js) | 1.28.1 | AGPL-3.0-or-later | © Artifex Software, Inc. | PDF engine (WebAssembly) |
| [svelte](https://github.com/sveltejs/svelte) | 5.57.1 | MIT | © Svelte contributors | UI runtime |
| [sortablejs](https://github.com/SortableJS/Sortable) | 1.15.7 | MIT | © SortableJS contributors | Drag and drop reordering |
| [comlink](https://github.com/GoogleChromeLabs/comlink) | 4.4.2 | Apache-2.0 | © Google LLC | Calls between the page and the worker |
| [workbox](https://github.com/GoogleChrome/workbox) (via vite-plugin-pwa) | 7.4.1 | MIT | © Google LLC | Service worker for offline use |
| [Material Symbols](https://github.com/marella/material-symbols) (`@material-symbols/svg-400`) | 0.47.5 | Apache-2.0 | © Google LLC | Icons (21 icons inlined as SVG paths) |

MuPDF.js includes MuPDF and its bundled third-party libraries (among them FreeType, HarfBuzz, libjpeg, OpenJPEG, zlib, lcms2, jbig2dec, gumbo and extract), which are distributed under their own permissive licences. See [mupdf.com/licensing](https://mupdf.com/licensing) and the MuPDF source tree.

## Used to build and test

These are not shipped to visitors.

| Package | Version | Licence |
| --- | --- | --- |
| [vite](https://github.com/vitejs/vite) | 8.3.2 | MIT |
| [@sveltejs/vite-plugin-svelte](https://github.com/sveltejs/vite-plugin-svelte) | 7.3.1 | MIT |
| [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) | 1.3.0 | MIT |
| [workbox-window](https://github.com/GoogleChrome/workbox) | 7.4.1 | MIT |
| [typescript](https://github.com/microsoft/TypeScript) | 6.0.3 | Apache-2.0 |
| [svelte-check](https://github.com/sveltejs/language-tools) | 4.7.6 | MIT |
| [@tsconfig/svelte](https://github.com/tsconfig/bases) | 5.0.8 | MIT |
| [vitest](https://github.com/vitest-dev/vitest) | 5.0.3 | MIT |
| [@playwright/test](https://github.com/microsoft/playwright) | 1.63.0 | Apache-2.0 |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | 22.20.4 | MIT |
| [@types/sortablejs](https://github.com/DefinitelyTyped/DefinitelyTyped) | 1.15.9 | MIT |

Their transitive dependencies (about 390 packages) are under MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, MPL-2.0, CC-BY-4.0 or CC0-1.0. All are permissive or weak-copyleft and compatible with the AGPL-3.0.

## Fonts and assets

- The app uses the visitor's system UI font; no font is downloaded.
- The test fixtures are printed with the system's Noto fonts (SIL Open Font License 1.1); the embedded subsets stay inside the fixture PDFs.
- The mangoidiots name and logo (`public/brand/mangoidiots-logo.png` and the icons generated from it) are Venkatarangan Thirumalai's own branding and are not covered by the AGPL.
