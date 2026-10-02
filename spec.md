> **About this file.** The original plan for PDFMango, written by Venkatarangan Thirumalai with Claude Cowork and handed to Claude Code as its starting point. It is kept as written; what changed during the build is in [prompt-history.md](prompt-history.md).

# PDFMango — build spec

Oct 1, 2026 · @Venkatarangan Thirumalai

## Overview

PDFMango is a free, open-source PDF tool at pdf.mangoidiots.com that runs entirely in the browser. It merges, reorders, rotates and deletes pages, turns JPG/PNG images into PDF pages, and compresses the result. Files never leave the visitor's device: there is no server, no upload, no storage and no account.

**Goals**

- **Simple:** a first-time visitor finishes a task in under a minute without reading instructions.
- **Fast:** the page grid appears within about 2 s for a 50-page PDF on a mid-range laptop once the engine is cached.
- **Private by construction:** no upload and nothing persisted. The only browser cache is the app's own code, for offline use.
- **Free to run:** a static site on GitHub Pages at pdf.mangoidiots.com.
- **Unicode-safe:** PDFs in Tamil or any other script keep selectable, searchable text through every operation except Scan compression.

**Not in v1**

- Editing text or images inside a page, annotations, signatures, filling forms
- OCR, PDF to Word/Excel, PDF to image export
- Accounts, history, cloud storage, share links
- A localised UI (English only)
- Any server-side processing

## Why PDFMango

PDFMango is the brand name; pdf.mangoidiots.com is its address. Use the text below as written in the README and on the About page.

> I often need to do simple things with PDFs: put the pages in the right order, turn a page that is the wrong way round, join two documents, or make a large file small enough to send by email. Every time I looked for a tool for this, I ended up with something full of ads, cluttered with features I did not need, wanting me to upload my documents to someone else's server, or working on only one platform. I could not find one that I felt was reliable, safe, modern and simple, all at the same time.
>
> So I decided to have one built. PDFMango brings together well-established open-source PDF libraries, and I used Claude AI to design and develop it. Your files never leave your device; all the work happens inside your browser. There are no ads, no sign-ups and no clutter, and it works the same way on Windows, Mac, Linux, Android and iPhone.
>
> PDFMango is completely open source. The full source code is on GitHub, free for anyone to use, learn from, improve and benefit from.
>
> — Venkatarangan Thirumalai

## Features and behaviour

Every edit is instant because it only changes a list of pages in memory; the real PDF is built once, when the visitor downloads.

### 1. Add files

- A large drop zone plus a "Choose files" button on the empty screen. Dropping anywhere on the window also works.
- Accepts `.pdf`, `.jpg`/`.jpeg` and `.png`, several at once. Other types are rejected with a one-line message (for HEIC or WebP: "Convert to JPG or PNG first").
- An "Add files" button stays in the toolbar; new pages are appended to the end of the grid.
- Each thumbnail shows a small tag with its source file name, so merged files stay distinguishable.
- Password-protected PDFs open a password prompt (see Edge cases).
- Size limits apply per device (see File limits).

### 2. Page grid

- Thumbnails render lazily as they scroll into view. About 160 px wide on desktop; two columns on phones.
- Under each thumbnail: its position in the output (1, 2, 3…) and the source tag.
- **Reorder:** drag with mouse; long-press then drag on touch; keyboard users select a page and press Alt+Arrow (or use Move left/right buttons).
- **Select:** click or tap toggles; Shift+click selects a range; Select all / Clear in the toolbar.
- **Per-page actions** on hover (desktop) or tap (mobile): rotate left, rotate right, delete.
- **Toolbar actions** apply to the selection, or to all pages when nothing is selected: rotate left, rotate right, delete.
- **Undo / redo** within the session (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z), using snapshots of the page list.
- **Preview:** double-click or double-tap opens one page large, with next/previous. Nice to have; drop it if it threatens the schedule.
- **Start over** clears everything after a confirm.

### 3. Rotate pages

- 90° steps, added to the page's existing rotation and normalised to 0, 90, 180 or 270.
- The thumbnail rotates instantly with a CSS transform; the real rotation is written at export.

### 4. Images to PDF

- Each image becomes one page, in the order added; it can then be reordered like any page.
- **Page size and margin options**, shown in the download dialog only when image pages exist:
  - **A4 (default):** 595.28 × 841.89 pt. Orientation follows the image (a landscape photo gets landscape A4). The image is fitted inside the page keeping its aspect ratio, centred within the margin. Margin is configurable for both page sizes: None (default), Small (18 pt, about 6 mm) or Medium (36 pt, about 13 mm).
  - **Original image size:** page size taken from the image's own resolution; if it has none, treat it as 96 ppi (1 px = 0.75 pt).
- Phone photos must appear upright: honour the EXIF orientation tag.
- JPEGs are embedded as-is without re-encoding (fast, no quality loss); PNGs keep transparency.

### 5. Compress

Four levels, chosen in the download dialog. Lossless is the default. Full spec in the next section.

### 6. Download

- One primary **Download** button opens a dialog (bottom sheet on phones) with: file name, compression level, image page size and margin (only if relevant), and Download.
- Default file name: `<original>-edited.pdf` for one source, `merged.pdf` for several PDFs, `images.pdf` for images only. Editable.
- Progress bar with step text ("Compressing images 12 of 40") and a Cancel button that stops the work.
- On finish, the browser downloads the file and a snackbar reports the result: "4.2 MB → 1.1 MB, 74% smaller".
- The grid stays as it was, so the visitor can adjust and download again.

## Compression levels

Three of the four levels keep text selectable; only Scan turns pages into pictures. The ppi and quality numbers are starting points to tune against the test files.

| Level | What it does | Text stays selectable | Good for |
| --- | --- | --- | --- |
| Lossless (default) | Removes unused and duplicate objects, recompresses streams, packs objects into object streams. No visual change. | Yes | Every download |
| Balanced | Lossless, plus images above 150 ppi downsampled to 150 ppi and re-encoded as JPEG quality 75 | Yes | Email attachments |
| Strong | Lossless, plus images downsampled to 96 ppi, JPEG quality 55 | Yes | Upload portals with size caps |
| Scan | Each page rendered at 110 ppi to a JPEG (quality 60) and rebuilt as an image-only PDF | **No** | Scanned paperwork; smallest file |

The dialog shows one plain line under each level, and Scan shows a warning: "Text will no longer be selectable or searchable."

### Lossless

Save with the MuPDF write options `garbage=deduplicate,compress,compress-fonts,compress-images,objstms`. Lossless always runs, because removed pages leave orphaned objects behind until garbage collection.

Font subsetting (`subsetFonts()`) is optional: enable it only if the spike shows no rendering changes on the Tamil and CJK test files.

### Image downsampling (Balanced, Strong)

MuPDF's write options compress images but do not downsample them, so the app does it with the JS API:

1. For each output page, walk `Resources → XObject`, recursing into Form XObjects. Collect image XObjects by object number, so an image shared by many pages is processed once.
2. Find each image's displayed size. Preferred: run the page through a custom `Device` whose `fillImage` callback receives the image and its transform matrix, which gives the exact size on the page. Fallback: assume the image spans the full page width (this under-compresses small images but never damages them).
3. Effective ppi = pixel width ÷ displayed width in inches. Skip the image when it is already within 1.2× the target, is 1-bit or an image mask, or has a soft mask (transparency).
4. `image.toPixmap(newWidth, newHeight)`, convert to DeviceRGB or DeviceGray to match the source, then `pixmap.asJPEG(quality, false)`.
5. Keep the new JPEG only if it is smaller than the original stream. If so, `doc.addImage(new mupdf.Image(jpegBytes))` and point every XObject entry that used the old image at the new one, keeping the same resource name.
6. Save with the Lossless options.

### Scan

For each output page: `page.toPixmap(scale(ppi/72), DeviceRGB, false, true)` → `asJPEG(60)` → add as an image page of the same size and orientation in a new document. Nothing else is carried over (no text, links or annotations).

### Safety net

If any level produces a file larger than the Lossless result, deliver the Lossless result instead and say so: "This file was already well compressed."

## Architecture

A static single-page app. All PDF work runs in one Web Worker hosting MuPDF.js; the UI edits only a lightweight page list and asks the worker to build the real PDF on download.

&#91;embedded content: app architecture · UI thread, worker, analytics\]

Edits change only the page list (highlighted). The worker builds the real PDF when the visitor downloads, and only anonymous usage events ever leave the browser.

### Stack

| Concern | Choice | Licence |
| --- | --- | --- |
| PDF engine | `mupdf` on npm (official MuPDF.js from Artifex, WebAssembly), pinned to the latest 1.x | AGPL-3.0-or-later |
| UI | Svelte 5 + TypeScript, built with Vite | MIT |
| Drag and drop | SortableJS (mouse + touch) | MIT |
| Worker calls | Comlink | Apache-2.0 |
| Offline / PWA | vite-plugin-pwa (Workbox) | MIT |
| Icons | Material Symbols, self-hosted subset | Apache-2.0 |
| Font | System UI font stack (Roboto on Android, SF on Apple, Segoe on Windows): no download | — |
| Tests | Vitest (unit), Playwright (end-to-end) | MIT / Apache-2.0 |

### Page model (main thread)

```ts
type Source = { id: string; name: string; kind: 'pdf' | 'image'; pageCount: number; sizeBytes: number };
type PageRef = { uid: string; sourceId: string; srcIndex: number; addedRotation: 0 | 90 | 180 | 270 };
type State = { sources: Map<string, Source>; pages: PageRef[]; selection: Set<string>; undo: PageRef[][]; redo: PageRef[][] };
```

Reorder, rotate and delete change only `pages`, with no worker call. The file bytes live only in the worker; the main thread transfers each `ArrayBuffer` (not copies) when a file is added.

### Worker API (via Comlink)

- `open(bytes, name, password?)` → `{ sourceId, pageCount, pageSizes, needsPassword, canAssemble, wasRepaired }`
- `addImage(bytes, name, mime)` → `{ sourceId, widthPx, heightPx }`
- `renderThumb(sourceId, srcIndex, widthPx)` → `ImageBitmap` (transferred)
- `export(pages, { level, imagePageSize }, onProgress)` → `{ bytes, inputSize, outputSize }` (bytes transferred)
- `cancel()`, `dispose(sourceId)`, `reset()`

### Export pipeline

1. Create a new empty `PDFDocument`.
2. For each PDF source, create one graft map (so shared fonts and images are copied once), then graft each listed page in output order.
3. Set each new page's `/Rotate` to (original rotation + added rotation) mod 360. Read the original from the grafted page, since `/Rotate` can be inherited from a parent node.
4. For image sources, add the image and build the page directly (A4 fit or original size).
5. Apply the chosen compression level, then `saveToBuffer(...)`.
6. Return the bytes; the main thread makes a Blob URL, triggers the download, then revokes the URL.

One pipeline covers single-file edits and merges alike. Building a fresh document also guarantees that deleted pages are physically gone from the output.

### Thumbnails and memory

- A render queue fed by an IntersectionObserver: visible pages first, off-screen requests cancelled. Thumbnails pause while an export runs.
- Render with `page.toPixmap(scale, DeviceRGB, false, true)`; convert to an `ImageBitmap` in the worker and transfer it.
- Call `.destroy()` on every MuPDF object (pages, pixmaps, images, documents) when done. This matters for 250 MB files.
- Load the WASM engine in the background right after first paint, so it is usually ready before the first file is dropped.

### MuPDF.js API map

| Task | API |
| --- | --- |
| Open a PDF | `mupdf.Document.openDocument(bytes, 'application/pdf')` |
| Password | `needsPassword()`, `authenticatePassword(pw)` |
| Respect restrictions | `hasPermission('assemble')` |
| New output document | `new mupdf.PDFDocument()` |
| Copy pages | `newGraftMap()`, then `graftPage(-1, srcDoc, srcIndex)` |
| Rotation | `findPage(i)` → read and `put('Rotate', n)` |
| Image page | `new mupdf.Image(bytes)`, `addImage(image)`, `addPage(mediabox, 0, resources, contents)`, `insertPage(-1, page)` |
| Thumbnail / Scan render | `page.toPixmap(matrix, colorspace, alpha, showExtras)` |
| Recompress an image | `loadImage(ref)`, `image.toPixmap(w, h)`, `pixmap.asJPEG(quality, false)` |
| Save | `saveToBuffer('garbage=deduplicate,compress,compress-fonts,compress-images,objstms')` |
| Repaired-file check | `wasRepaired()` |

Check every call against the docs for the exact version installed; the API changes between minor releases.

### Configuration

All tunable values live in one file, `src/pdfmango.config.ts`, so behaviour can change without hunting through the code:

```ts
export const config = {
  appName: 'PDFMango',
  siteUrl: 'https://pdf.mangoidiots.com',
  repoUrl: 'https://github.com/<account>/pdfmango',
  creditLine: 'Generated with Claude Opus 5.5',
  analytics: { measurementId: 'G-XXXXXXXXXX', liveHostname: 'pdf.mangoidiots.com' },
  limits: { mobileMaxMB: 50, desktopMaxMB: 250, maxPages: 1000 },
  respectOwnerRestrictions: true, // false = load restricted PDFs, with a notice
  imagePages: { defaultSize: 'A4', defaultMargin: 'none', marginsPt: { none: 0, small: 18, medium: 36 } },
  compression: {
    balanced: { ppi: 150, jpegQuality: 75 },
    strong:   { ppi: 96,  jpegQuality: 55 },
    scan:     { ppi: 110, jpegQuality: 60 },
  },
} as const;
```

`respectOwnerRestrictions` is a setting for the site owner, changed in the code and redeployed. It is not a switch visitors see.

## UI and visual design

One screen, white, Material 3-inspired, with mango as the only accent colour. Light theme only in v1.

### Layout

- **Top app bar (56 px):** the mangoidiots logo + "PDFMango" on the left; "About" and "Source code" (GitHub) links on the right.
- **Empty state:** a centred card with a dashed rounded border, an upload icon, "Drop PDFs or images here", a filled "Choose files" button, and one line below: "Merge, reorder, rotate and compress. Your files never leave your device."
- **Working state, desktop:** a sticky toolbar under the app bar (Add files · Rotate left · Rotate right · Delete · Select all · Undo · Redo) and a filled mango **Download** button on its right.
- **Working state, phone:** the toolbar becomes a bottom bar of icons; Download is the prominent button at its right end.
- **Page cards:** 12 px corners, a light outline, slight elevation on hover. Selected = 2 px mango outline + a check badge in the corner.
- **Download dialog:** a centred dialog on desktop, a bottom sheet on phones.
- **Feedback:** a linear progress bar inside the dialog; a snackbar for results and errors.
- **Footer:** "PDFMango v1.0.0 · Free and open source (AGPL-3.0) · Your files never leave your device · Generated with Claude Opus 5.5 · A mangoidiots.com project".

### Logo and brand

- **Logo:** download a copy of [the mangoidiots square logo](https://venkatarangan.com/wp-content/uploads/2026/03/mangoidiots-square-small.png) into the repo (`public/brand/mangoidiots-logo.png`) and serve it from there. Never hotlink it.
- From the same file, generate the favicon, Apple touch icon and PWA icons (192 and 512 px, plus a maskable version).
- Make a 1200 × 630 social preview image (`public/social-preview.png`) with the logo, "PDFMango" and the line "Merge, reorder, rotate and compress PDFs. Your files never leave your device." Set the Open Graph and Twitter card tags to it.
- Name it "PDFMango" everywhere the product is named: page title, manifest, README, About page. "pdf.mangoidiots.com" is only the address.
- The version shown in the footer comes from `package.json`, so it always matches the build.

### Visual tokens

| Token | Value | Use |
| --- | --- | --- |
| Background | #FFFFFF | Page |
| Surface | #F7F7F8 | Toolbar, dialogs, empty-state card |
| Outline | #E3E3E6 | Card borders, dividers |
| Text | #1C1B1F | Body and titles |
| Text, secondary | #5F6368 | Tags, hints |
| Mango | #FFA41B | Primary button fill, selection outline, progress bar |
| On mango | #1C1B1F | Text and icons on mango fills (dark text, not white) |
| Mango ink | #9A5B00 | Links and accent text on white |
| Danger | #B3261E | Delete confirmations, errors |

- Check every text/background pair meets WCAG AA (4.5:1). White text on mango fails; always use dark text on mango.
- Corners: 12 px cards and dialogs, fully rounded (pill) buttons.
- Type: system UI stack; body 14/20, section titles 16/24, page title 22/28.
- Motion: 150–200 ms transitions; honour `prefers-reduced-motion`.

### Accessibility

- Full keyboard operation, including reorder; visible focus rings in mango ink.
- Tap targets at least 44 × 44 px.
- Progress and results announced through an `aria-live` region.
- Every icon button has a text label (tooltip on desktop, `aria-label` always).

## Limits, analytics, privacy and licence

Phones get 50 MB, computers 250 MB; analytics never sees file names or content; the repo is AGPL-3.0 because MuPDF.js is.

### File limits

- **Phones and tablets:** up to 50 MB total across all files in the session.
- **Computers:** up to 250 MB total.
- **Pages:** up to 1,000 pages in total across all files. A file that would take the total past 1,000 is refused with a message giving the limit.
- **Detecting a phone:** treat the device as mobile if `navigator.userAgentData?.mobile` is true, or if `matchMedia('(pointer: coarse) and (hover: none)')` matches. Where `navigator.deviceMemory` is 4 GB or less, also apply the 50 MB limit.
- A file that would exceed the size limit is refused with a friendly message naming the limit and suggesting a computer for larger files.
- Out-of-memory errors from the engine are caught and shown as "This file is too large for this device's memory", never as a crash.
- All three limits live in the configuration file (see Architecture).

### Analytics (Google Analytics 4)

- Venkat supplies the GA4 tag; the measurement ID goes in the configuration file.
- **No consent banner.** Decision: PDFMango has no ads or commercial interest, so nothing interrupts the visitor. Disclose analytics on the About page instead.
- **Behave like Mudalali's analytics:**
  - Runs only on the live hostname, pdf.mangoidiots.com. Never on localhost or preview builds.
  - Loads only after the app has fully loaded, so it never slows the first screen.
  - Skips itself when the device is offline, or when the browser sends Do Not Track (`navigator.doNotTrack === '1'`) or Global Privacy Control (`navigator.globalPrivacyControl === true`).
- Initialise `gtag` from a small external script file, not an inline snippet, so the Content Security Policy can stay strict.
- **Events:** page views, plus `file_added` {kind: pdf | image}, `export` {level} and `error` {code}. Nothing derived from a file: no names, sizes, page counts or text.

### Privacy

- Files are read with the browser's File API straight into the worker. Nothing is uploaded.
- The app itself writes nothing to localStorage, IndexedDB or cookies. The service worker caches only the app's own files, never user files. (When analytics runs, Google sets its own first-party cookies; the About page says so.)
- The About page carries a **Privacy and analytics** section, worded after Mudalali's. Use this text:

  > PDFMango uses Google Analytics to count anonymous visits to the live site. Nothing about your files (their names, contents, pages or sizes) is ever collected or sent anywhere; your PDFs and images are processed entirely inside your browser. Analytics runs only on the live site (never while testing locally), waits until the app has fully loaded, and skips itself automatically if you are offline or your browser sends a Do Not Track or Global Privacy Control signal. Google sets its own first-party cookies to measure traffic; see [Google's privacy policy](https://policies.google.com/privacy) for details. PDFMango's full source is open on GitHub.
- The About page also carries a short **Disclaimer**:

  > PDFMango is a free tool, built with AI assistance on open-source libraries, and is provided as is, without warranty of any kind. Always keep a copy of your original files. All names, logos and trademarks belong to their respective owners.
- **Content-Security-Policy** as a `<meta>` tag (GitHub Pages can't set headers). Starting point, to adjust as needed:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' https://www.googletagmanager.com;
connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com;
img-src 'self' data: blob: https://*.google-analytics.com https://www.googletagmanager.com;
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
object-src 'none'; base-uri 'self'
```

### Licence

- Repo licence: AGPL-3.0-or-later. This is required because MuPDF.js is AGPL.
- A visible "Source code" link in the header and footer pointing at the public GitHub repo. This meets AGPL's duty to offer the source to people using the app over a network.
- A `THIRD_PARTY_NOTICES.md` listing MuPDF.js (Artifex) and every other dependency with its licence.
- The mangoidiots name and logo are Venkat's own branding.

## Deployment

A push to `main` builds and publishes to GitHub Pages automatically; pdf.mangoidiots.com points at it through one DNS record.

1. **Repo:** a public GitHub repo named `pdfmango`, licensed AGPL-3.0. Venkat connects his GitHub account in the coding environment; Claude Code creates the repo and pushes to it.
2. **Build:** a Vite multi-page build. `index.html` is the app at `/`; `about/index.html` is the About page at `/about/`. Use `base: '/'`, because the site lives at the root of its own subdomain. Use hashed file names, and include `.nojekyll`.
3. **Straight into the app:** pdf.mangoidiots.com opens the app immediately. No splash screen, landing page, cookie or consent banner, or install prompt; the drop zone is the first thing a visitor sees.
4. **CI:** a GitHub Actions workflow on push to `main`: `npm ci` → `npm test` → `npm run build` → browser smoke tests → `actions/upload-pages-artifact` → `actions/deploy-pages`. In repo Settings → Pages, set the source to "GitHub Actions". Generated site files are never committed.
5. **Domain file:** `public/CNAME` containing `pdf.mangoidiots.com`.
6. **DNS:** wherever mangoidiots.com's DNS is managed, add a CNAME record: host `pdf` → `<github-username>.github.io`. Put these steps in the README.
7. **HTTPS:** in Settings → Pages, enter the custom domain and tick "Enforce HTTPS" once GitHub has issued the certificate.
8. **Domain verification:** verify mangoidiots.com in the GitHub account's Pages settings, so no one else can claim the subdomain.
9. **WASM check:** confirm on the live site that `.wasm` is served as `application/wasm`. If it isn't, fall back to fetching it as an ArrayBuffer before instantiating.
10. **Smoke test** after every deploy: load the site, open a sample PDF, download, open /about/, and check the console for CSP errors.

## Documentation and public pages

The README explains PDFMango to people who read or reuse the code; the About page explains it to people who use it. Follow the pattern of the [mangoidiots-solitaire repo](https://github.com/venkatarangan/mangoidiots-solitaire).

### README.md (repo root), in this order

1. Cover image (the social preview) and a one-line description
2. "Generated with Claude Opus 5.5." and "Use it at https://pdf.mangoidiots.com"
3. Why PDFMango: the text from the Why PDFMango section above
4. Features
5. Screenshots, desktop and phone, made with the test fixtures (never personal documents)
6. Privacy and analytics: the same text as the About page
7. How to use: short numbered steps
8. Development: requirements, `npm ci`, `npm run dev`, `npm test`, `npm run build`
9. GitHub Pages deployment and custom domain, including the DNS steps
10. Configuration: the config file and what each value does
11. Project structure: a table of folders and their purpose
12. Credits and licence: MuPDF.js by Artifex and the other libraries; AGPL-3.0

### About page (pdf.mangoidiots.com/about/)

A plain static page in the same look as the app, linked from the app bar and the footer:

- What PDFMango does, in three or four lines
- Why PDFMango (the same text as the README)
- How to use, in five short steps
- Privacy and analytics, and the Disclaimer (texts in the Privacy section)
- Open source: link to the repo, the licence, credits to MuPDF.js and the other libraries
- The same footer as the app

### Other files in the repo

- `SPECIFICATION.md`: this spec, kept current as decisions change
- `initial-prompt.txt` and `prompt-history.md`: the prompts used to build PDFMango, as in the solitaire repo, with any private context removed
- `LICENSE` (AGPL-3.0) and `THIRD_PARTY_NOTICES.md`
- `CHANGELOG.md`: what changed in each version

## Edge cases and known limitations

The app handles each of these with a clear message rather than a silent failure. Bookmarks and form fields are the main v1 compromises.

| Case | Behaviour |
| --- | --- |
| PDF needs a password to open | Prompt for it; retry on a wrong password. The downloaded copy is not password-protected, and the dialog says so. |
| PDF's owner forbids page assembly | Respected by default: the file isn't loaded, and the message says the author has restricted page changes. The site owner can override this with `respectOwnerRestrictions: false` in the config; the file then loads with a notice. |
| Damaged PDF | MuPDF repairs on open. Show "This file had errors and was repaired — check the result." |
| Bookmarks (outline) | Not carried over in v1. Say so in the dialog when a source had bookmarks. |
| Links | Links to websites survive. Links that jump to another page may break after reordering or merging. |
| Form fields | Pages copy across, but fields may stop working after a merge. Warn when a source has a form. |
| Digitally signed PDF | Any change invalidates the signature. Warn before export. |
| Tamil and other Unicode text | Preserved: fonts and content are copied unchanged. If a font isn't embedded, the thumbnail may look different, but the output file is unchanged. |
| More than 1,000 pages | Refused, with a message giving the limit. Lazy thumbnails keep 1,000 pages smooth. |
| HEIC or WebP image | Rejected in v1 with "Convert to JPG or PNG first." |
| Transparent PNG | Transparency is kept. |
| CMYK JPEG | Embedded as-is. |
| Compression makes it bigger | Deliver the smaller Lossless result instead (see Safety net). |
| Out of memory | Caught; friendly message. The app stays usable after Start over. |
| iPhone Safari | The 50 MB limit applies. Test the download flow specifically, as Safari handles downloads differently. |

## Milestones, acceptance and tests

Seven milestones, in order; the first is a gate that must pass before the rest is built.

### Milestones

1. **Spike (gate).** In a throwaway Vite + worker project, prove: MuPDF.js loads from a static host; merging via graft map; rotation; an image page with EXIF orientation; image downsampling via `toPixmap` + `asJPEG` + `addImage`; the custom-Device image-size measurement; thumbnail speed on a 50-page file. Write findings and timings to `SPIKE.md`. If any item fails, stop and report options.
2. **Skeleton and deploy.** Repo, Vite + Svelte + TypeScript, CI to Pages, CNAME, CSP, empty state live at pdf.mangoidiots.com.
3. **Core editing.** Add PDFs, page grid, lazy thumbnails, reorder, rotate, delete, select, undo/redo, download with Lossless.
4. **Images to PDF.** JPG/PNG pages, A4 and original-size options, EXIF orientation.
5. **Compression.** Balanced, Strong, Scan and the safety net, with progress and cancel.
6. **Polish.** Phone layout, offline/PWA, file limits, error messages, accessibility, About page, README and repo docs, GA4 (no consent banner, Mudalali-style), social preview image, footer and licence notices.
7. **Test and launch.** Run the full test plan on real devices, fix, tag v1.0.

### Acceptance criteria

- [ ] Visiting pdf.mangoidiots.com opens the app directly: no splash, banner or extra click before the drop zone.
- [ ] Lighthouse on the app: Performance ≥ 90 (mobile), Accessibility ≥ 95.
- [ ] App JavaScript (excluding the WASM engine) ≤ 150 KB gzipped; the engine loads after first paint and is cached for later visits.
- [ ] A 50-page text PDF shows its grid within 2 s on a mid-range laptop (engine already cached).
- [ ] A 1,000-page PDF loads, scrolls smoothly and exports on desktop Chrome; page 1,001 is refused with the limit message.
- [ ] Merge 3 PDFs + 5 JPGs, reorder, rotate, delete, download: the file opens correctly in Chrome's viewer, Adobe Acrobat Reader and macOS Preview.
- [ ] Image pages come out with no margin by default, and with the right margin when Small or Medium is chosen.
- [ ] A Tamil Unicode PDF stays selectable and searchable after reorder, merge and Balanced compression; copied text matches the original.
- [ ] Balanced compression makes a photo-heavy test PDF at least 40% smaller (target; record the actual figure).
- [ ] DevTools network log shows no request carrying file data; the only third-party requests are GA hits.
- [ ] No analytics requests on localhost, when offline, or with Do Not Track or Global Privacy Control turned on.
- [ ] Works offline after the first visit.
- [ ] A 250 MB PDF exports on desktop Chrome; a 50 MB PDF exports on a mid-range Android phone (Chrome) and an iPhone (Safari).
- [ ] The main flow can be completed with the keyboard alone.
- [ ] README and /about/ are published, with the Why PDFMango text, the privacy and analytics text, the disclaimer and the credits.

### Test corpus (put in `tests/fixtures/`)

- A Tamil Unicode text PDF with embedded fonts
- A mixed English + CJK PDF
- A 200-page text-only PDF
- A photo-heavy PDF (about 20 MB)
- A scanned PDF (one image per page)
- A PDF with bookmarks, internal links and a form
- A password-protected PDF and an owner-restricted PDF
- A deliberately damaged PDF
- Phone photos in portrait and landscape with EXIF orientation set; a transparent PNG
- A 250 MB PDF for the desktop limit (generated, not committed)

### Automated tests

- **Vitest:** page-model logic (reorder, rotate normalisation, delete, undo/redo), file-name defaults, limit detection, compression-option mapping.
- **Playwright:** the main flow end to end against the fixtures, with checks on page count, page order and `/Rotate` values in the output.

## Instructions for Claude Code

Build in milestone order, run the spike first, and stop to report whenever reality differs from this spec.

- Read this whole spec before writing code. Treat the ppi, quality and timing numbers as targets to measure, not facts.
- **Spike first.** Do not start milestone 2 until `SPIKE.md` exists and every spike item passed. If one fails, stop and present options to Venkat.
- **Pin `mupdf`** to an exact version and check every API call against the docs for that version.
- **Dependencies:** open-source only, with licences compatible with AGPL-3.0. Record each one in `THIRD_PARTY_NOTICES.md`. Ask before adding anything not listed in Stack.
- **Main thread stays free:** every MuPDF call runs in the worker; `ArrayBuffer`s are transferred, not copied; `.destroy()` every MuPDF object.
- **No user data persisted:** no localStorage, IndexedDB or cookies from the app. Never log file names or content in production builds or analytics.
- **Commits:** one or more per milestone with clear messages. Keep `README.md` current with run, test, build and deploy steps.
- **Tests:** write the Vitest and Playwright tests alongside the features, not at the end.
- **Ask Venkat for:** the GA4 tag, and someone to add the DNS record. Everything else is settled in Decisions below; Venkat connects the GitHub account in the coding environment.

### Decisions from Venkat

| Topic | Decision |
| --- | --- |
| Brand and address | PDFMango, at pdf.mangoidiots.com |
| Repo | `pdfmango`, public, AGPL-3.0; Venkat connects GitHub in the coding environment |
| Opening the site | Straight into the app, no extra steps |
| Look | Clean white, Material-like, neutral, with a mango accent |
| Logo | A copy of the mangoidiots square logo, stored in the repo |
| Image pages | A4 by default, original size as an option; margin configurable, default none |
| Compression | Four levels: Lossless (default), Balanced, Strong, Scan |
| File limits | 50 MB on phones, 250 MB on computers, 1,000 pages in total |
| Owner restrictions | Respected by default; overridable in the config |
| Analytics | Google Analytics 4 with Venkat's tag; no consent banner; Mudalali-style behaviour and disclosure |
| UI language | English only; PDFs in any script, including Tamil, are supported |
| Build model | Claude Code with Claude Opus 5.5 |

## Sources

- [MuPDF.js on GitHub (Artifex)](https://github.com/artifexsoftware/mupdf.js) — official library, AGPL or commercial licence
- [mupdf on npm](https://npmjs.com/package/mupdf)
- [PDFDocument API reference](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFDocument.html) — grafting, page tree, saving
- [PDF write options](https://mupdf.readthedocs.io/en/latest/reference/common/pdf-write-options.html) — garbage, compress, object streams
- [Image API](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/Image.html) and [Pixmap API](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/Pixmap.html) — downscaled decode, JPEG encode
- [Mudalali](https://mudalali.mangoidiots.com/) — model for the privacy and analytics wording and behaviour
- [mangoidiots-solitaire repo](https://github.com/venkatarangan/mangoidiots-solitaire) — model for the README and repo docs
- [mangoidiots square logo](https://venkatarangan.com/wp-content/uploads/2026/03/mangoidiots-square-small.png)
