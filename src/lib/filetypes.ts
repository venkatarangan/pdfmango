// Recognises files by their first bytes (extensions lie), with the extension as a hint for messages.

export type Sniffed =
  | { kind: 'pdf' }
  | { kind: 'image'; mime: 'image/jpeg' | 'image/png' }
  | { kind: 'docx' }
  | { kind: 'text' }
  | { kind: 'rejected'; message: string };

const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

export function sniff(head: Uint8Array, name: string): Sniffed {
  // PDF readers accept a header anywhere in the first 1 KB.
  const limit = Math.min(head.length - 4, 1024);
  for (let i = 0; i <= limit; i++) if (ascii(head, i, '%PDF')) return { kind: 'pdf' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (ascii(head, 0, '\x89PNG\r\n\x1a\n')) return { kind: 'image', mime: 'image/png' };

  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const isHeif = ascii(head, 4, 'ftyp') && ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heis', 'avif'].some((b) => ascii(head, 8, b));
  const isWebp = ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP');
  if (isHeif || isWebp || ['heic', 'heif', 'webp', 'avif'].includes(ext)) {
    return { kind: 'rejected', message: `${name}: convert to JPG or PNG first.` };
  }
  if (ext === 'pdf') return { kind: 'rejected', message: `${name} doesn't look like a PDF file.` };

  // Word (.docx) is a zip package; the converter checks the inside.
  if (ext === 'docx') return ascii(head, 0, 'PK\x03\x04') ? { kind: 'docx' } : { kind: 'rejected', message: `${name} doesn't look like a Word (.docx) file.` };
  if (ext === 'doc') return { kind: 'rejected', message: `${name}: open it in Word and save it as .docx first.` };
  if (['rtf', 'odt', 'pages', 'wps'].includes(ext)) return { kind: 'rejected', message: `${name}: save it as .docx or PDF first.` };
  if (ext === 'txt') {
    if (head.length === 0) return { kind: 'rejected', message: `${name} is empty.` };
    const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
    // Text has no zero bytes (except UTF-16, which starts with a byte-order mark).
    return utf16 || !head.includes(0) ? { kind: 'text' } : { kind: 'rejected', message: `${name} doesn't look like a text file.` };
  }
  return { kind: 'rejected', message: `${name}: PDFMango opens PDF, JPG, PNG, Word (.docx) and text (.txt) files.` };
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const ACCEPT = `.pdf,.jpg,.jpeg,.png,.docx,.txt,application/pdf,image/jpeg,image/png,${DOCX_MIME},text/plain`;
