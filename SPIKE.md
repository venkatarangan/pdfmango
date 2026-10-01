# PDFMango — Spike findings (Milestone 1)

1 Oct 2026 · run by Claude Code (Claude Opus 5.5) · **Result: every gate item passed.** A few MuPDF.js calls in the spec don't exist in this version and need a different route; those are listed under [Where reality differs from the spec](#where-reality-differs-from-the-spec).

## Setup

| | |
| --- | --- |
| Engine | `mupdf` **1.28.1** (latest on npm, pinned exactly). WASM 10.4 MB raw, 4.8 MB gzip; JS glue 90 KB. Max WASM heap: **2 GB** |
| Build | Vite 8.3.2, Comlink 4.4.2, module worker (`worker.format: 'es'`) |
| Browser | Playwright 1.63.0 Chromium (headless shell 153) |
| Machine | Intel i7-12700H laptop (WSL2), Node 22.22. This is faster than the spec's "mid-range laptop"; see the note under Timings |
| Code | Throwaway, in `spike/`: `make-fixtures.mjs` (test corpus), `spike-node.mjs` (19 API checks), `web/` + `spike-browser.mjs` (static build in Chromium), `spike-large.mjs`, `spike-heap.mjs`, `spike-subset.mjs` |

## Gate items

| # | Item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | MuPDF.js loads from a static host | **Pass** | `vite build` → static `dist/` served by a plain static server. `.wasm` served as `application/wasm`; Vite fingerprints it (`mupdf-wasm-<hash>.wasm`). The spec's CSP (`'wasm-unsafe-eval'`) produced **no violations and no console errors**. MuPDF already falls back from streaming compile to ArrayBuffer by itself. |
| 2 | Merge via graft map | **Pass** | 3 PDFs (Tamil, CJK, 50-page), 6 pages in a mixed order; each output page's extracted text equals its source page's. One graft map per source copies a shared image once: 2.33 MB vs 4.66 MB with separate grafts. |
| 3 | Rotation | **Pass** | Source with `/Rotate 90` only on the `Pages` node. After `graftPage`, `getInheritable('Rotate')` on the new page returns 90; adding 0/90/270/180 writes 90/180/0/270 and the page bounds flip as expected (L,P,P,L). |
| 4 | Image page with EXIF orientation | **Pass** | Phone-style JPEGs with orientation 1, 3, 6 and 8: rendered output has the red band on top, blue at the bottom, green on the left for all four; portrait photos get portrait A4, landscape get landscape. JPEG stays `DCTDecode`, scan data byte-identical (no re-encode). PNG transparency kept (`SMask`). Margins None/Medium and "original size" verified (EXIF 72 dpi → 1 px = 1 pt; PNG with no pHYs → 96 ppi). |
| 5 | Downsampling (`toPixmap` + `asJPEG` + `addImage`) | **Pass, different call** (see below) | Photo-heavy PDF **21.6 MB → 1.45 MB (−93%) Balanced** in 1.1 s; **→ 0.52 MB (−98%) Strong** in 0.6 s; images shared by two pages stay shared; transparent image skipped; already-small image skipped. Target was ≥ 40%. (Synthetic photos; record the real figure in M7.) |
| 6 | Custom-Device image-size measurement | **Pass** | `new mupdf.Device({ fillImage(image, ctm) {…} })` → displayed size = `hypot(ctm[0],ctm[1])` × `hypot(ctm[2],ctm[3])`. Matched back to object numbers for **12/12** images (see below). 3000×2000 px at 648×432 pt → 333 ppi; small 1200 px image at 108 pt → 800 ppi, exactly. |
| 7 | Thumbnail speed, 50-page file | **Pass** | Worker renders 50 thumbnails at 320 px (160 CSS px @2x) and transfers `ImageBitmap`s: **grid complete in 143 ms**, first thumbnail 21 ms, first 12 in 52 ms. 200 pages: 424 ms. Target: 2 s. |

### Also checked (not gate items, but cheap to prove now)

| Check | Result |
| --- | --- |
| Lossless save options `garbage=deduplicate,compress,compress-fonts,compress-images,objstms` | Accepted by 1.28.1 with no warnings |
| Tamil + CJK text after merge, reorder **and Balanced** | Extracted text byte-identical to the source on every page; `யாதும் ஊரே யாவரும் கேளிர்` and the CJK phrases are found |
| Scan level (110 ppi, q60) | 21.6 MB → 0.70 MB, 71 ms/page; no text left in output |
| Password PDF | `needsPassword()` true; wrong password → 0; right → 2; the exported copy opens without a password |
| Owner-restricted PDF | `hasPermission('assemble')` false (all other perms reported correctly) |
| Damaged PDF (broken xref + startxref) | Opens, all 50 pages, `wasRepaired()` true |
| Bookmarks / forms / signatures detection | `loadOutline()` (3 items), `Root.AcroForm.Fields` (1), `SigFlags & 1` for signed; internal vs external links via `Link.isExternal()` |
| **250 MB PDF** (26 pages of large JPEGs) | Lossless: reverse-order merge + save in 1.2 s; **WASM heap peaks at 1.25 GB** of the 2 GB cap. Balanced: 253 MB → 6 MB in 6.2 s |
| `subsetFonts()` | No rendering change on any file. See finding 6 |

### Timings (Chromium, worker, localhost)

| | Cold visit | Warm visit |
| --- | --- | --- |
| First contentful paint | 112 ms | 24 ms |
| Engine ready (WASM compiled + instantiated) | 425 ms after navigation | 329 ms |
| 50-page grid (open + 50 thumbs) | 143 ms | — |
| 200-page grid | 424 ms | — |

Chrome's CPU throttling (`Emulation.setCPUThrottlingRate 4×`) does **not** slow down Web Workers, so a mid-range laptop could not be simulated here. Even at 3–4× slower single-thread speed, the 50-page grid stays far below 2 s. Network download of the 4.8 MB (gzip) engine is not included (localhost).

## Where reality differs from the spec

1. **`image.toPixmap(newWidth, newHeight)` does not exist** in 1.28.1. `Image.toPixmap()` takes no arguments, and decoding full size and then scaling would waste memory.
   **What works:** draw the image into a pixmap of the target size:
   ```js
   const pix = new mupdf.Pixmap(cs, [0, 0, nw, nh], false); pix.clear(255);
   const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
   dev.fillImage(image, [nw, 0, 0, nh, 0, 0], 1); dev.close();
   pix.asJPEG(quality, false);
   ```
   This uses MuPDF's own area-averaging scaler, and JPEGs are decoded at a reduced scale (lower memory than a full decode). Same quality goal as the spec, different call.

2. **The Device `fillImage` callback gives an `Image`, not an object number.** I matched each one back by pointer: `doc.loadImage(ref).pointer === image.pointer`. This works because MuPDF caches loaded images by their PDF object. It matched 12/12; if a match ever fails, the spec's fallback (assume full page width) applies.

3. **No JS API for EXIF orientation.** A 30-line JPEG EXIF parser reads the tag, and the page's `cm` matrix applies all 8 orientations. The image data itself is still not re-encoded.
   **Proposed addition (needs Venkat's OK):** also **strip the EXIF/XMP/IPTC/comment segments** from photos before embedding them. Reasons:
   (a) phone photos carry **GPS location** and device serial numbers, which would otherwise end up inside the shared PDF;
   (b) a viewer that honours EXIF inside PDFs would rotate the photo a second time.
   Only metadata is removed (88 bytes for the test photo). The pixels are untouched, and ICC colour profiles and the Adobe/CMYK marker are kept.

4. **Resolution must be read before stripping.** `Image.getXResolution()` reads EXIF/JFIF/pHYs, so the app reads it from the original bytes. Note for "Original image size": phones write **72 dpi**, so a 4032×3024 photo becomes a 56 × 42 in page. That follows the spec exactly, but it may surprise people. A4 stays the default.

5. **Saving with `garbage=…` renumbers objects in the in-memory document.** Any `PDFObject` handle held from before the save then points at the wrong object. The export pipeline therefore takes fresh handles after each save. Safety-net order: build → save Lossless (keep bytes) → walk pages again → downsample → save → keep the smaller.

6. **`subsetFonts()`**: no rendering changes on any test file. On a fully embedded Tamil TrueType font it cut 38 KB → 8 KB. On a CJK CFF font from a `.ttc` collection it logged `format error: Index bounds` and left that font unsubset (no damage). Subsetting would also break typing new values into form fields whose fonts get subset.
   **Recommendation:** subsetting **off for Lossless** (keeps the promise of no changes at all), **on for Balanced and Strong**, as a config switch.

7. **Thumbnails:** use a 4-channel pixmap cleared to opaque white and draw the page into it, rather than the spec's `toPixmap(…, alpha=false)`. `ImageData` needs RGBA, and MuPDF's alpha pixmaps are premultiplied (text edges would come out slightly dark). This gives straight RGBA with no per-pixel JS loop.

## Decisions taken after the spike (Venkat, 1 Oct 2026)

| Topic | Decision |
| --- | --- |
| Photo metadata | **Strip** EXIF/XMP/IPTC/comment segments from JPEGs before embedding; pixels never re-encoded; ICC and Adobe markers kept |
| Font subsetting | **Balanced and Strong only**, behind a config switch; Lossless never subsets |
| Repository | Build and commit **locally only**; create and push the GitHub repo only when Venkat says so |

## Risks to carry forward

- **250 MB is near the practical ceiling.** Grafting copies every stream into the new document and the output buffer grows by doubling, so a 253 MB input peaks at a 1.25 GB WASM heap (cap 2 GB). That's fine for the 250 MB limit, and the out-of-memory message covers the rest. If it bites in M7, a single-source export could edit the source document in place instead (`rearrangePages`), which avoids the copy.
- **First-visit download is the WASM engine (10.4 MB, 4.8 MB gzipped).** Check on the live site that GitHub Pages gzips `.wasm` (it can't serve the `.br` files MuPDF ships). Later visits come from the service worker cache.
- The Vite build warns that MuPDF's Node-only `node:fs`/`module` imports are externalised. That's harmless (guarded at runtime), but the app build will silence the warning.
- Cross-viewer checks (Chrome viewer, Acrobat, macOS Preview, iPhone Safari) are manual and belong to M7.

## Test corpus produced

`spike/make-fixtures.mjs` generates every file the spec lists. Content is reproducible, but the bytes are not: Chromium writes timestamps and document IDs. It moves to `scripts/make-fixtures.mjs` in M2, with output in `tests/fixtures/`:

| File | Size | Notes |
| --- | --- | --- |
| `tamil-unicode.pdf` | 39 KB | 3 pages, Noto Sans Tamil embedded (Chromium print), public-domain verses |
| `english-cjk.pdf` | 119 KB | Simplified Chinese, Japanese, Korean |
| `text-50.pdf`, `text-200.pdf` | 114 / 416 KB | One heading + paragraphs per page |
| `photo-heavy.pdf` | 21.6 MB | 9 camera-like 3000×2000 JPEGs (one shared by two pages), one small 800 ppi image, one transparent PNG |
| `scanned.pdf` | 1.5 MB | 6 pages, one greyscale JPEG each |
| `bookmarks-links-form.pdf` | 20 KB | Outline, internal + external links, one AcroForm text field |
| `password-mango.pdf`, `owner-restricted.pdf` | 40 KB | AES-256; password `mango`; the restricted one forbids assembly |
| `damaged.pdf` | 113 KB | Broken xref and startxref |
| `phone-*-exif{1,3,6,8}.jpg`, `transparent.png`, `plain.png` | ~0.5 MB each | EXIF photos have orientation markers (red top, blue bottom, green left) |
| `large-250mb.pdf` | 253 MB | `--large` flag only; never committed |
