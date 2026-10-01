# Prompt history

The prompts used to build PDFMango with Claude Code (Claude Opus 5.5), in order, with private context removed. The build spec itself is `SPECIFICATION.md`; the first prompt is also in `initial-prompt.txt`.

## 1 Oct 2026

### 1. Start

> read @spec.md and begin your work.

Claude ran the milestone 1 spike first (see `SPIKE.md`). Every gate item passed, but a few MuPDF.js 1.28.1 calls differ from the spec, so Claude stopped and asked three questions.

### 2. Answers after the spike

| Question | Answer |
| --- | --- |
| Phone photos carry EXIF metadata (GPS location, device serials). When a JPG becomes a PDF page, should PDFMango strip that metadata? The image pixels are never re-encoded either way. | **Strip metadata (Recommended)** |
| Font subsetting caused no visual change in any test, but one CJK font failed to subset (left intact, no damage), and subsetting can break typing into form fields. Where should it run? | **Balanced + Strong only (Recommended)** |
| Milestone 2 creates a public GitHub repo 'pdfmango' under your account, pushes to it, and sets up Pages CI. Go ahead? | **Build locally only** (scaffold and commit locally; push later) |

Claude then built milestones 2–6 locally and committed them.
