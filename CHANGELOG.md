# Changelog

All notable changes to PDFMango. Versions follow [semantic versioning](https://semver.org/).

## [0.1.0] — unreleased (built locally, not yet deployed)

First complete build, milestones 1–6 of the spec.

### Changed (2 Oct 2026)

- Empty screen explains what PDFMango is, links to About, and quotes why it was built, credited to Venkatarangan Thirumalai.
- Footer is shorter: the AI credit moved to a new "Built with AI" section on the About page, and the Source code link lives in the app bar only.
- About page opens with the social-preview image (also cached for offline use).

### Added

- Spike (milestone 1) proving MuPDF.js 1.28.1 in a static site; findings in `SPIKE.md`.
- Add PDFs, JPGs and PNGs by drop (anywhere on the window) or file picker; HEIC/WebP and other types refused with a one-line message.
- Page grid with lazy thumbnails, source tags, drag reorder (long-press on touch), keyboard reorder (Alt+Arrow), selection (click, Shift+click, select all), per-page and toolbar rotate/delete, undo/redo, preview, start over.
- Images to PDF with EXIF orientation, A4 or original size, None/Small/Medium margin; JPEGs embedded without re-encoding and with photo metadata (GPS, serials) removed.
- Download dialog: file name, Lossless/Balanced/Strong/Scan compression with safety net, progress and cancel, result snackbar.
- Password prompt, owner-restriction check (configurable), repaired-file notice, bookmark/form/signature notices.
- Size limits (50 MB phones, 250 MB computers) and a 1,000-page limit; out-of-memory errors shown as a friendly message.
- Phone layout (bottom bar, bottom sheet), accessibility (keyboard operation, live region, labels, 44 px targets), offline support (service worker), About page, GA4 analytics (inactive until the measurement ID is set).
- Vitest and Playwright test suites; generators for fixtures, brand assets, icons and screenshots; GitHub Pages workflow.
