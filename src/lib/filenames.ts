import type { SourceKind } from './types';

/** Replaces characters that Windows, macOS or Android refuse in file names. */
export function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** File name without its extension, made safe. */
export function baseName(name: string): string {
  return sanitize(name.replace(/\.[A-Za-z0-9]{1,5}$/, '')) || 'document';
}

/**
 * Default download name for the sources still used by the page list:
 * `images.pdf` for images only, `<original>-edited.pdf` for one PDF, `merged.pdf` otherwise.
 */
export function defaultFileName(used: ReadonlyArray<{ name: string; kind: SourceKind }>): string {
  if (used.length === 0) return 'document.pdf';
  if (used.every((s) => s.kind === 'image')) return 'images.pdf';
  if (used.length === 1) return `${baseName(used[0].name)}-edited.pdf`;
  return 'merged.pdf';
}

/** Tidies a name the visitor typed: safe characters, always ending in .pdf. */
export function finalFileName(typed: string, fallback: string): string {
  const stem = sanitize(typed.trim().replace(/\.pdf$/i, ''));
  return stem ? `${stem}.pdf` : fallback;
}
