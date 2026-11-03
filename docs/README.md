# Docs

How PDFMango was planned and built, and what is planned next.

| File or folder | What it holds |
| --- | --- |
| [spec.md](spec.md) | The original plan, written with Claude Cowork before any code, with an addendum for the 0.4.0 page tools (Straighten, Fine rotate, Straighten photo, Split book spreads, Crop) |
| [SPIKE.md](SPIKE.md) | The engine checks run before building: what MuPDF.js could do in a browser, and where it differed from the plan |
| [prompt-history.md](prompt-history.md) | The prompts used to build the first release, word for word, with what each one led to |
| [change-requests/](change-requests/README.md) | Requests for improvements, one file each, kept after they are built |
| [screenshots/](screenshots/) | The pictures used in the main README, made by `npm run screenshots` from the test files |

The code that ran the engine checks is in [`spike/`](../spike/) at the top of the repo.
