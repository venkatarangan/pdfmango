import type { Settings } from './settings';
import type { CompressionLevel, ImageMargin } from './types';

/** MuPDF write options used for every download: GC + dedupe, recompress streams, object streams. */
export const LOSSLESS_OPTIONS = 'garbage=deduplicate,compress,compress-fonts,compress-images,objstms';

export type CompressionPlan =
  | { kind: 'lossless' }
  | { kind: 'downsample'; ppi: number; quality: number; subsetFonts: boolean }
  | { kind: 'scan'; ppi: number; quality: number };

export function planFor(level: CompressionLevel, s: Settings): CompressionPlan {
  switch (level) {
    case 'lossless':
      return { kind: 'lossless' };
    case 'balanced':
      return { kind: 'downsample', ppi: s.balanced.ppi, quality: s.balanced.jpegQuality, subsetFonts: s.balanced.subsetFonts };
    case 'strong':
      return { kind: 'downsample', ppi: s.strong.ppi, quality: s.strong.jpegQuality, subsetFonts: s.strong.subsetFonts };
    case 'scan':
      return { kind: 'scan', ppi: s.scan.ppi, quality: s.scan.jpegQuality };
  }
}

export type LevelInfo = { id: CompressionLevel; label: string; hint: string; warning?: string };

/** The four levels with one plain line each; the numbers follow the visitor's settings. */
export function levels(s: Settings): LevelInfo[] {
  return [
    { id: 'lossless', label: 'Lossless', hint: 'Tidies the file with no visible change. Best for every download.' },
    { id: 'balanced', label: 'Balanced', hint: `Shrinks large photos to ${s.balanced.ppi} ppi. Good for email attachments.` },
    { id: 'strong', label: 'Strong', hint: `Shrinks photos to ${s.strong.ppi} ppi. For upload portals with size caps.` },
    {
      id: 'scan',
      label: 'Scan',
      hint: 'Turns every page into a picture. Smallest file, for scanned paperwork.',
      warning: 'Text will no longer be selectable or searchable.',
    },
  ];
}

export const MARGINS: ReadonlyArray<{ id: ImageMargin; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
];
