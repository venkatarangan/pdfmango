import { config } from '../pdfmango.config';
import type { CompressionLevel, ImageMargin } from './types';

/** MuPDF write options used for every download: GC + dedupe, recompress streams, object streams. */
export const LOSSLESS_OPTIONS = 'garbage=deduplicate,compress,compress-fonts,compress-images,objstms';

export type CompressionPlan =
  | { kind: 'lossless' }
  | { kind: 'downsample'; ppi: number; quality: number; subsetFonts: boolean }
  | { kind: 'scan'; ppi: number; quality: number };

export function planFor(level: CompressionLevel): CompressionPlan {
  const c = config.compression;
  switch (level) {
    case 'lossless':
      return { kind: 'lossless' };
    case 'balanced':
      return { kind: 'downsample', ppi: c.balanced.ppi, quality: c.balanced.jpegQuality, subsetFonts: c.balanced.subsetFonts };
    case 'strong':
      return { kind: 'downsample', ppi: c.strong.ppi, quality: c.strong.jpegQuality, subsetFonts: c.strong.subsetFonts };
    case 'scan':
      return { kind: 'scan', ppi: c.scan.ppi, quality: c.scan.jpegQuality };
  }
}

export const LEVELS: ReadonlyArray<{ id: CompressionLevel; label: string; hint: string; warning?: string }> = [
  { id: 'lossless', label: 'Lossless', hint: 'Tidies the file with no visible change. Best for every download.' },
  { id: 'balanced', label: 'Balanced', hint: 'Shrinks large photos to 150 ppi. Good for email attachments.' },
  { id: 'strong', label: 'Strong', hint: 'Shrinks photos to 96 ppi. For upload portals with size caps.' },
  {
    id: 'scan',
    label: 'Scan',
    hint: 'Turns every page into a picture. Smallest file, for scanned paperwork.',
    warning: 'Text will no longer be selectable or searchable.',
  },
];

export const MARGINS: ReadonlyArray<{ id: ImageMargin; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
];

export function marginPt(m: ImageMargin): number {
  return config.imagePages.marginsPt[m];
}
