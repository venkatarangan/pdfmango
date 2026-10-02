// Writing systems that Word and text conversion can draw, beyond what the engine has built in
// (Latin, Greek, Cyrillic, Chinese, Japanese, Korean). Each needs a Noto Sans font from public/fonts,
// fetched only when a document uses that script.

export type ScriptFont = { script: string; file: string; ranges: [number, number][] };

/** `script` matches the name MuPDF passes to the font loader (case-insensitive). */
export const SCRIPT_FONTS: ScriptFont[] = [
  { script: 'Devanagari', file: 'NotoSansDevanagari', ranges: [[0x0900, 0x097f], [0xa8e0, 0xa8ff]] },
  { script: 'Bengali', file: 'NotoSansBengali', ranges: [[0x0980, 0x09ff]] },
  { script: 'Gurmukhi', file: 'NotoSansGurmukhi', ranges: [[0x0a00, 0x0a7f]] },
  { script: 'Gujarati', file: 'NotoSansGujarati', ranges: [[0x0a80, 0x0aff]] },
  { script: 'Oriya', file: 'NotoSansOriya', ranges: [[0x0b00, 0x0b7f]] },
  { script: 'Tamil', file: 'NotoSansTamil', ranges: [[0x0b80, 0x0bff]] },
  { script: 'Telugu', file: 'NotoSansTelugu', ranges: [[0x0c00, 0x0c7f]] },
  { script: 'Kannada', file: 'NotoSansKannada', ranges: [[0x0c80, 0x0cff]] },
  { script: 'Malayalam', file: 'NotoSansMalayalam', ranges: [[0x0d00, 0x0d7f]] },
  { script: 'Arabic', file: 'NotoSansArabic', ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]] },
];

/** The scripts (from SCRIPT_FONTS) that appear in `text`. */
export function scriptsIn(text: string): ScriptFont[] {
  const found = new Set<ScriptFont>();
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x0600) continue; // fast path: Latin, Greek, Cyrillic, Hebrew need nothing extra
    const s = SCRIPT_FONTS.find((f) => f.ranges.some(([lo, hi]) => c >= lo && c <= hi));
    if (s) found.add(s);
    if (found.size === SCRIPT_FONTS.length) break;
  }
  return [...found];
}
