// Choices and rules for saving pages as images, shared by the export dialog and Settings.
import { config } from '../pdfmango.config';
import type { ImageFormat } from './types';

export const IMAGE_FORMATS: { id: ImageFormat; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'png', label: 'PNG' },
  { id: 'jpg', label: 'JPG' },
];

const DPI_NAMES: Record<keyof typeof config.imageExport.dpiChoices, string> = { screen: 'Screen', standard: 'Standard', print: 'Print' };

/** "Screen (96 dpi)" etc.; a dpi not in the named list just shows its number. */
export function dpiLabel(dpi: number): string {
  const entry = (Object.entries(config.imageExport.dpiChoices) as [keyof typeof DPI_NAMES, number][]).find(([, v]) => v === dpi);
  return entry ? `${DPI_NAMES[entry[0]]} (${dpi} dpi)` : `${dpi} dpi`;
}

/** Phones share at most this many images at a time; computers have no limit (they get a ZIP). */
export const MAX_IMAGES_ON_PHONES = config.imageExport.maxOnPhones;

export const PHONE_LIMIT_MESSAGE = `On phones you can save up to ${MAX_IMAGES_ON_PHONES} pages as images at a time. Select ${MAX_IMAGES_ON_PHONES} or fewer pages.`;
