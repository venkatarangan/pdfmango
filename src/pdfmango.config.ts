// Every tunable value in one place. Change it here, rebuild, redeploy.
// Visitors can override some of these in the Settings dialog (see src/lib/settings.ts); these stay the defaults.
export const config = {
  appName: 'PDFMango',
  siteUrl: 'https://pdf.mangoidiots.com',
  repoUrl: 'https://github.com/venkatarangan/pdfmango',
  // Written into each downloaded PDF's document properties (Producer); visitors can change it in Settings.
  creditLine: 'Exported with pdf.mangoidiots.com',
  // Analytics stays off while measurementId is the placeholder.
  analytics: { measurementId: 'G-96E07LF8L2', liveHostname: 'pdf.mangoidiots.com' },
  limits: { mobileMaxMB: 50, desktopMaxMB: 250, maxPages: 1000 },
  respectOwnerRestrictions: true, // false = load restricted PDFs, with a notice
  imagePages: { defaultSize: 'A4', defaultMargin: 'none', marginsPt: { none: 0, small: 18, medium: 36 } },
  // Pages saved as images. Phones share at most `maxOnPhones` at a time (a hard limit); computers get a ZIP.
  imageExport: {
    defaultFormat: 'auto', // 'auto' picks PNG or JPG per page; 'png' | 'jpg' force one
    defaultDpi: 150,
    dpiChoices: { screen: 96, standard: 150, print: 300 },
    jpegQuality: 85,
    maxPixels: 25_000_000, // per image; a bigger page is scaled down to fit
    maxOnPhones: 10,
  },
  compression: {
    balanced: { ppi: 150, jpegQuality: 75, subsetFonts: true },
    strong: { ppi: 96, jpegQuality: 55, subsetFonts: true },
    scan: { ppi: 110, jpegQuality: 60 },
  },
  // New page tools. Each can be switched off here and redeployed if it causes trouble.
  features: {
    straighten: true, // Straighten: finds and fixes a small tilt (up to ±15°) without re-rendering the page
    fineRotate: true, // the fine-rotate slider in the page preview
    straightenPhoto: true, // Straighten photo: drag four corners to flatten a photo of a sheet
    splitSpreads: true, // Split book spreads into separate pages
  },
  straighten: { maxAngle: 15, sliderRange: 10 },
  // Photos flattened with Straighten photo are saved as JPEG at this quality, long side capped.
  straightenPhoto: { maxSidePx: 3000, jpegQuality: 90 },
  split: {
    minAspect: 1.2, // a spread is at least this much wider than tall
    middleBand: [0.4, 0.6], // where the spine is looked for, as a share of the width
    minConfidence: 4, // how far the spine must stand out (z-score); below this the page is flagged for review
    defaultOverlap: 0.01, // each half reaches this share of the width past the spine
  },
} as const;

export type Config = typeof config;
