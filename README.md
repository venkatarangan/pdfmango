![PDFMango](public/social-preview.png)

# PDFMango

A free, open-source PDF tool that runs entirely in your browser. Your files never leave your device.

**Use it at https://pdf.mangoidiots.com** · Generated with Claude Opus 5.5 ([how it was built](prompt-history.md))

## Why PDFMango

> I often need to do simple things with PDFs: put the pages in the right order, turn a page that is the wrong way round, join two documents, or make a large file small enough to send by email. Every time I looked for a tool for this, I ended up with something full of ads, cluttered with features I did not need, wanting me to upload my documents to someone else's server, or working on only one platform. I could not find one that I felt was reliable, safe, modern and simple, all at the same time.
>
> So I decided to have one built. PDFMango brings together well-established open-source PDF libraries, and I used Claude AI to design and develop it. Your files never leave your device; all the work happens inside your browser. There are no ads, no sign-ups and no clutter, and it works the same way on Windows, Mac, Linux, Android and iPhone.
>
> PDFMango is completely open source. The full source code is on GitHub, free for anyone to use, learn from, improve and benefit from.
>
> — [Venkatarangan Thirumalai](https://thefoundercatalyst.com/venkatarangan)

## Features

- Merge PDFs and JPG/PNG photos into one PDF.
- Reorder (drag, or Alt+Arrow keys), rotate, delete and duplicate pages, insert blank pages, reverse the order, and select odd or even pages; undo and redo.
- Save just the selected pages as a new PDF, or save pages as PNG or JPG images (Auto picks per page) at screen, standard or print resolution. Phones share up to 10 images at a time; computers get one ZIP.
- Photos become upright pages, A4 or original size, with GPS and other hidden details removed.
- Four compression levels: Lossless, Balanced, Strong and Scan.
- Preview the finished PDF (with its size, and whether it's small enough to email) before downloading, and share it straight to other apps on phones.
- Downloaded PDFs start with empty document properties: the originals' author, title and hidden XMP data are not copied. You can set a title of your own.
- Keeps Tamil, CJK and all other text selectable.
- Handles password-protected and damaged PDFs, up to 1,000 pages.
- Works on phones and offline, with no upload, account or ads.

## Screenshots

| Desktop | Phone |
| --- | --- |
| ![Page grid on desktop](docs/screenshots/desktop-grid.png) | ![Page grid on a phone](docs/screenshots/phone-grid.png) |
| ![Download options on desktop](docs/screenshots/desktop-download.png) | ![Download options on a phone](docs/screenshots/phone-download.png) |

Made with the test files in `tests/fixtures/`.

## Privacy and analytics

PDFMango uses Google Analytics to count anonymous visits to the live site. Nothing about your files (their names, contents, pages or sizes) is ever collected or sent anywhere; your PDFs and images are processed entirely inside your browser. Analytics runs only on the live site (never while testing locally), waits until the app has fully loaded, and skips itself automatically if you are offline or your browser sends a Do Not Track or Global Privacy Control signal. Google sets its own first-party cookies to measure traffic; see [Google's privacy policy](https://policies.google.com/privacy) for details. PDFMango's full source is open on GitHub.

If you change Settings, only your choices are saved in your browser. In the GA4 property, keep Enhanced measurement's "File downloads" and "Outbound clicks" switched off.

## How to use

1. Drop PDFs or photos on the page, or press **Choose files**.
2. Drag pages into order.
3. Select pages to rotate or delete them.
4. Press **Preview** and pick a compression level.
5. Press **Preview & Share** to check the result, then **Download** or **Share** it. (**Direct Download** skips the check.)

## Development

Needs Node.js 22.

```bash
npm ci                # install
npm run dev           # run locally at http://localhost:5173
npm test              # unit tests
npm run build         # build into dist/
npx playwright test   # browser tests (after npm run build)
```

`npm run fixtures` regenerates the test files; `npm run brand`, `npm run icons` and `npm run screenshots` regenerate the icons and images.

## Deployment

Every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/deploy.yml`.

One-time setup, already done for pdf.mangoidiots.com:

1. Repo Settings → Pages → Source: **GitHub Actions**.
2. DNS: a `CNAME` record from `pdf` to `venkatarangan.github.io` (on Cloudflare, set it to **DNS only**).
3. Settings → Pages → Custom domain: `pdf.mangoidiots.com`, then tick **Enforce HTTPS**.
4. Verify `mangoidiots.com` under your GitHub account's Pages settings.

## Configuration

Defaults live in [`src/pdfmango.config.ts`](src/pdfmango.config.ts): analytics ID, size and page limits, image page size and margins, saving pages as images (format, resolutions, the 10-image phone limit), compression settings, the credit line written into each PDF, and whether restricted PDFs are refused. Visitors can override some of these for themselves in the app's **Settings**.

## Project structure

| Folder | What's in it |
| --- | --- |
| `src/` | The app: `components/` (screens and dialogs), `lib/` (page list, settings, helpers), `worker/` (PDF engine) |
| `about/` | The About page |
| `public/` | Logo, icons, domain file |
| `tests/` | Unit tests, browser tests and test files |
| `scripts/` | Generators for test files, icons and screenshots |
| `spike/` | The engine checks done before building ([SPIKE.md](SPIKE.md)) |

The original plan is in [spec.md](spec.md).

## Credits and licence

Built on [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js) by Artifex, Svelte, SortableJS, Comlink, Workbox and Material Symbols ([full list](THIRD_PARTY_NOTICES.md)).

Licensed under the [GNU AGPL-3.0](LICENSE), as MuPDF.js requires. The mangoidiots name and logo are Venkatarangan Thirumalai's own branding.
