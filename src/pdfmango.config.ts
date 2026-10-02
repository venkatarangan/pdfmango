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
} as const;

export type Config = typeof config;
