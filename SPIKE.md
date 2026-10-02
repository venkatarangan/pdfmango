# Engine spike

Before building the app, Claude Code checked that the PDF engine (MuPDF.js **1.28.1**) could do everything the plan needed in a browser. The throwaway code is in `spike/`.

**Result: every check passed** (1 Oct 2026, on an Intel i7-12700H laptop).

| Check | Result |
| --- | --- |
| Loads from a static site under the strict security policy | Engine ready in about 0.4 s; no policy errors |
| Merge PDFs | Pages in the right order; shared images copied once |
| Rotate | Works, including rotation inherited from the page tree |
| Photos as pages | Upright for every EXIF orientation; JPEGs not re-encoded; PNG transparency kept |
| Shrink images (Balanced) | 21.6 MB photo PDF → 1.45 MB (93% smaller) in 1.1 s |
| Measure how big each image is shown | Exact for 12 of 12 images |
| Thumbnails for a 50-page PDF | All 50 in 0.14 s (target: 2 s) |
| Passwords, restricted and damaged PDFs | Detected and handled |
| Tamil and CJK text | Identical after merging and compression |
| 250 MB PDF | Exports; uses about 1.25 GB of the engine's 2 GB memory limit |

## Differences from the plan

- `image.toPixmap(width, height)` does not exist in 1.28.1. Images are shrunk by drawing them onto a smaller canvas instead, which works just as well.
- The engine reports images without their PDF object numbers; they are matched by memory address instead.
- There is no EXIF reader in the engine, so a small one was written.
- Font subsetting worked on Tamil but skipped one CJK font (no damage), so it is used only for Balanced and Strong.

## Worth knowing

- 250 MB is close to the practical memory ceiling; larger files may fail with a "too large for this device" message.
- The engine is a 10 MB download (4.8 MB compressed) on the first visit; after that it comes from the browser's cache.
