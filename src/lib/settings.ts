// Visitor settings: a small set of config defaults a visitor may override from the Settings dialog.
// Every value is picked from a fixed list (or, for the credit line, sanitised text), and anything
// read back from storage is validated, so a bad or stale value can never break the tool.
import { config } from '../pdfmango.config';
import type { ImageMargin, ImagePageSize } from './types';

export type QualitySettings = { ppi: number; jpegQuality: number };
export type Settings = {
  creditLine: string; // '' = leave the PDF's Producer field empty
  respectOwnerRestrictions: boolean;
  desktopMaxMB: number;
  mobileMaxMB: number;
  imageDefaultSize: ImagePageSize;
  imageDefaultMargin: ImageMargin;
  marginSmallPt: number;
  marginMediumPt: number;
  balanced: QualitySettings & { subsetFonts: boolean };
  strong: QualitySettings & { subsetFonts: boolean };
  scan: QualitySettings;
};

export const DEFAULTS: Settings = {
  creditLine: config.creditLine,
  respectOwnerRestrictions: config.respectOwnerRestrictions,
  desktopMaxMB: config.limits.desktopMaxMB,
  mobileMaxMB: config.limits.mobileMaxMB,
  imageDefaultSize: config.imagePages.defaultSize,
  imageDefaultMargin: config.imagePages.defaultMargin,
  marginSmallPt: config.imagePages.marginsPt.small,
  marginMediumPt: config.imagePages.marginsPt.medium,
  balanced: { ...config.compression.balanced },
  strong: { ...config.compression.strong },
  scan: { ...config.compression.scan },
};

/** The config default is always one of the choices, even if someone edits the config later. */
const withDefault = (list: number[], d: number) => [...new Set([...list, d])].sort((a, b) => a - b);

export const CHOICES = {
  desktopMaxMB: withDefault([100, 150, 200, 250, 300], DEFAULTS.desktopMaxMB),
  mobileMaxMB: withDefault([25, 50, 75, 100], DEFAULTS.mobileMaxMB),
  marginSmallPt: withDefault([9, 18, 27], DEFAULTS.marginSmallPt),
  marginMediumPt: withDefault([27, 36, 54, 72], DEFAULTS.marginMediumPt),
  balancedPpi: withDefault([120, 150, 200], DEFAULTS.balanced.ppi),
  balancedQuality: withDefault([60, 75, 85], DEFAULTS.balanced.jpegQuality),
  strongPpi: withDefault([72, 96, 120], DEFAULTS.strong.ppi),
  strongQuality: withDefault([40, 55, 70], DEFAULTS.strong.jpegQuality),
  scanPpi: withDefault([72, 110, 150, 200], DEFAULTS.scan.ppi),
  scanQuality: withDefault([40, 60, 75], DEFAULTS.scan.jpegQuality),
} as const;

export const CREDIT_MAX = 100;

/** Printable text only, single line, at most CREDIT_MAX characters. */
export function cleanCredit(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CREDIT_MAX);
}

const pick = <T>(v: unknown, allowed: readonly T[]): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keeps only valid overrides from untrusted (stored) data. */
export function sanitizeOverrides(raw: unknown): Partial<Settings> {
  if (!isObj(raw)) return {};
  const out: Partial<Settings> = {};
  if ('creditLine' in raw && typeof raw.creditLine === 'string') out.creditLine = cleanCredit(raw.creditLine);
  if (typeof raw.respectOwnerRestrictions === 'boolean') out.respectOwnerRestrictions = raw.respectOwnerRestrictions;
  const num = <K extends 'desktopMaxMB' | 'mobileMaxMB' | 'marginSmallPt' | 'marginMediumPt'>(k: K) => {
    const v = pick(raw[k], CHOICES[k] as readonly number[]);
    if (v !== undefined) out[k] = v as Settings[K];
  };
  num('desktopMaxMB');
  num('mobileMaxMB');
  num('marginSmallPt');
  num('marginMediumPt');
  const size = pick(raw.imageDefaultSize, ['A4', 'original'] as const);
  if (size) out.imageDefaultSize = size;
  const margin = pick(raw.imageDefaultMargin, ['none', 'small', 'medium'] as const);
  if (margin) out.imageDefaultMargin = margin;
  for (const level of ['balanced', 'strong'] as const) {
    const v = raw[level];
    if (!isObj(v)) continue;
    const ppi = pick(v.ppi, CHOICES[`${level}Ppi`] as readonly number[]) ?? DEFAULTS[level].ppi;
    const jpegQuality = pick(v.jpegQuality, CHOICES[`${level}Quality`] as readonly number[]) ?? DEFAULTS[level].jpegQuality;
    const subsetFonts = typeof v.subsetFonts === 'boolean' ? v.subsetFonts : DEFAULTS[level].subsetFonts;
    out[level] = { ppi, jpegQuality, subsetFonts };
  }
  if (isObj(raw.scan)) {
    const ppi = pick(raw.scan.ppi, CHOICES.scanPpi as readonly number[]) ?? DEFAULTS.scan.ppi;
    const jpegQuality = pick(raw.scan.jpegQuality, CHOICES.scanQuality as readonly number[]) ?? DEFAULTS.scan.jpegQuality;
    out.scan = { ppi, jpegQuality };
  }
  return out;
}

export function merge(overrides: Partial<Settings>): Settings {
  return {
    ...DEFAULTS,
    ...overrides,
    balanced: { ...DEFAULTS.balanced, ...overrides.balanced },
    strong: { ...DEFAULTS.strong, ...overrides.strong },
    scan: { ...DEFAULTS.scan, ...overrides.scan },
  };
}

/** Only the values that differ from the defaults (what gets stored). */
export function diff(s: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (JSON.stringify(s[k]) !== JSON.stringify(DEFAULTS[k])) out[k] = s[k];
  }
  return out as Partial<Settings>;
}

export function marginPtFor(s: Settings, m: ImageMargin): number {
  return m === 'small' ? s.marginSmallPt : m === 'medium' ? s.marginMediumPt : 0;
}
