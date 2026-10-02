# How PDFMango was built

## Background

Venkatarangan Thirumalai first worked out the idea with **Claude Cowork**: what the tool should do, how it should look, and how it should protect privacy. That conversation produced a detailed plan, [spec.md](spec.md). The plan was then handed to **Claude Code** (Claude Opus 5.5), which built PDFMango from it.

## Prompts to Claude Code

**1 Oct 2026**

1. > read @spec.md and begin your work.

   Claude ran the engine spike first ([SPIKE.md](SPIKE.md)). Everything passed, but a few engine calls differed from the plan, so it stopped to ask three questions:
   - Strip hidden metadata (GPS, serials) from photos? → **Yes**
   - Where should font subsetting run? → **Balanced and Strong only**
   - Create the GitHub repo now? → **No, build locally first**

   Claude then built and tested the app locally.

**2 Oct 2026**

2. > launch the app for me to check
3. > ensure no pii or private information gets public. then publish it to github, I have made the DNS changes.

   Claude checked every file, the git history and the file metadata, and replaced the personal email in the commits with GitHub's no-reply address. It then published the repo and the site.
4. > in the main page of the app, i wish to show two lines on what is PDFMango, give a link to the about page, also write one line on why I wrote it. show me the lines for approval
5. > let us go with What is PDFMango and #B
6. > in the text, give my full name, venkatarangan thirumalai and hyperlink venkatarangan thirumalai to https://thefoundercatalyst.com/venkatarangan, move the about pdfmango hyperlink next to the intro text and not after my quote. in the about page, include social-preview.png it will make it look better. remove the source code hyperlink in the footer. remove 'generated with claude opus 5.5" in the footer and instead move that information to the About Page, below Open Source, create a new section and add the AI details.
7. > 1) in the configuration, make the default value: creditLine from "Generated with Claude Opus 5.5" to "Exported with pdf.mangoidiots.com". 2) Add a settings option in the page to override only these configuration defaults by the user, remember the changes in local browser: creditline, respectOwnerRestrictions, limits.desktopMaxMB, limits.mobileMaxMB, imagePages.defaultMargin, imagePages.defaultSize, imagePages.marginsPt, compression.balanced, compression.strong, compression.scan - make these easy selectable values for enduser, don't make them type raw values and break the tool; give an option to reset all overrides to default set in the config.ts.
8. > in the main app page move the intro line "PDFMango is a free, open-source PDF tool that works entirely in your browser. Merge, reorder, rotate and delete pages, turn photos into PDF pages, and shrink big files to email size" to the top, above drop pdfs files. rest of the text can be below "Drop PDFs"
9. > in prompt-history.md, you mention "read @spec.md and begin your work", but you never shipped spec.md; as you remember I ideated with claude cowork to come up with a detailed plan, which was written as spec.md as the starting point for claude code to work, this background has to be told in brief, and the original spec.md shared in the repo & linked in prompt-history, ensure there are no PII or private information in that. simplify the different files like spec.md, specification.md and initial-prompt.txt files and consolidate. 2) overall, make all the repo files - markdown and docs simple, easy to read, and not too verbose and cluttered.

## What changed from the plan

| Topic | Plan said | What was built |
| --- | --- | --- |
| Photos | Embed JPEGs as-is | Still not re-encoded, but hidden metadata (GPS, serials) is removed first |
| Font subsetting | Optional | Only for Balanced and Strong |
| Engine calls | `image.toPixmap(w, h)` for shrinking images | Not in MuPDF.js 1.28.1; images are redrawn at the smaller size instead |
| Settings | Nothing stored; restrictions setting not shown to visitors | A Settings dialog; only the visitor's choices are saved in their browser, never anything about files |
| Credit line | "Generated with Claude Opus 5.5" in the footer | "Exported with pdf.mangoidiots.com" in each PDF's document properties; the AI credit is on the About page |
| Footer | Included a Source code link | Source code link is in the app bar only |
| Repo files | `SPECIFICATION.md` and `initial-prompt.txt` | Merged into `spec.md` (the original plan) and this file |
