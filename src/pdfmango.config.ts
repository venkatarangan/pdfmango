// Every tunable value in one place. Change it here, rebuild, redeploy.
// Visitors can override some of these in the Settings dialog (see src/lib/settings.ts); these stay the defaults.
export const config = {
  appName: 'PDFMango',
  siteUrl: 'https://pdf.mangoidiots.com',
  repoUrl: 'https://github.com/venkatarangan/pdfmango',
  // Written into each downloaded PDF's document properties (Producer); visitors can change it in Settings.
  creditLine: 'Exported with pdf.mangoidiots.com',
  // Analytics stays off while measurementId is the placeholder.
  analytics: { measurementId: 'G-XXXXXXXXXX', liveHostname: 'pdf.mangoidiots.com' },
  limits: { mobileMaxMB: 50, desktopMaxMB: 250, maxPages: 1000 },
  respectOwnerRestrictions: true, // false = load restricted PDFs, with a notice
  imagePages: { defaultSize: 'A4', defaultMargin: 'none', marginsPt: { none: 0, small: 18, medium: 36 } },
  compression: {
    balanced: { ppi: 150, jpegQuality: 75, subsetFonts: true },
    strong: { ppi: 96, jpegQuality: 55, subsetFonts: true },
    scan: { ppi: 110, jpegQuality: 60 },
  },
} as const;

export type Config = typeof config;
