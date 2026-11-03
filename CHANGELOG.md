# Changelog

## 0.4.0 (November 2026)

- **Straighten:** fixes pages scanned or photographed slightly crooked (up to 15°), from Page tools or the page preview. The tilt is measured from the lines of text, and the page is turned back without redrawing it, so text stays selectable. Pages with no clear lines of text are left alone.
- **Fine rotate:** a slider in the page preview turns a page by up to 10° either way, in 0.1° steps, with Reset. It is saved the same way as Straighten.
- **Straighten photo:** drag four corners onto a photographed sheet and it becomes a flat, cropped page. Photo pages only. On phones a magnifier shows under your finger; the corners also move with the arrow keys.
- **Split book spreads:** turns scans or photos of two facing pages into two pages, for a whole book at once, as one undoable step. It finds the spine (a dark fold or a white gap), straightens a slanted spine first, and leaves covers and single pages alone. Splits it is unsure about get a **Check split** badge and a Review that steps through them. Any page can also be split by hand from the page preview. Choose an overlap (none, 1% or 2%) and Right page first for right-to-left books.
- Each new tool can be switched off in `src/pdfmango.config.ts` (`features`).
- Docs: the README and About page now say that signing and comments are left out on purpose, because Google Chrome on Windows, Mac and Linux can do both.

## 0.3.0 (October 2026)

- Add **Word (.docx)** and **text (.txt)** files: they become A4 pages you can merge, reorder, compress and save like any other. Headings, bold and italic, lists, tables and pictures come across; Word's exact fonts, headers and footers do not.
- Word and text files can be in the main Indian languages (Tamil, Hindi, Marathi, Telugu, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Odia) and Arabic or Urdu, as well as English, Chinese, Japanese and Korean. Each language's font is fetched only the first time a file needs it, then kept for offline use.
- Older formats get a clear message: save .doc as .docx; save .rtf, .odt and .pages as .docx or PDF.
- Fixed: a damaged image now says "This image couldn't be read" instead of the PDF message.
- Fixed: "Extract as PDF", "Extract as images" and "Save all" were missing a space.

## 0.2.1 (October 2026)

- Clearer page tools: the ⋮ button is now a labelled **Page tools** menu, and the phone's bottom bar has labels (Add, Left, Right, Delete, More).
- Selecting pages shows a bar with the count, Duplicate, **Extract as PDF** and **Extract as images**. On phones, Extract as images is greyed out above 10 pages, with the reason shown.
- The main button is now **Save all N pages** and always saves every page; the "Only the selected pages" checkbox is gone.
- Fixed: on 320 px phones (iPhone SE size) the page no longer scrolls sideways.

## 0.2.0 (October 2026)

- Save pages as images: PNG or JPG (Auto picks per page), at Screen, Standard or Print resolution. Phones share up to 10 images at a time; computers download one ZIP.
- Save only the selected pages as a PDF.
- Duplicate pages, insert a blank page, reverse the page order, select odd or even pages; all can be undone.
- Optional document title; page-level hidden metadata is no longer copied into downloaded PDFs.
- Settings: default format and resolution for images.
- Google Analytics switched on for the live site (still skipped offline and with Do Not Track or Global Privacy Control), now on the About page too.

## 0.1.0 (October 2026)

First release.

- Merge PDFs and photos; reorder, rotate and delete pages; undo and redo.
- Photos become upright pages (A4 or original size), with their hidden metadata removed.
- Four compression levels: Lossless, Balanced, Strong and Scan.
- Handles password-protected, restricted and damaged PDFs, up to 1,000 pages.
- Works on phones, works offline after the first visit, and can be used with the keyboard alone.
- Settings dialog to change the defaults in your own browser.
- Preview the finished PDF before downloading, with its size and an email check; Share to other apps on phones.
