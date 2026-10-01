// Minimal JPEG segment handling: read the EXIF orientation tag and strip metadata segments.
// Pixels are never touched, so a JPEG is still embedded without re-encoding.

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const SOS = 0xda;
const APP1 = 0xe1; // EXIF, XMP
const APP13 = 0xed; // Photoshop IPTC
const COM = 0xfe;

/** Walks marker segments up to the start of scan. Calls `visit(marker, start, end)` for each. */
function walkSegments(b: Uint8Array, visit: (marker: number, start: number, end: number) => boolean | void): number {
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === SOS || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd8) {
      i += 2; // standalone markers have no length
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) break;
    if (visit(marker, i, i + 2 + len) === false) break;
    i += 2 + len;
  }
  return i;
}

export function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** EXIF Orientation tag (1–8) from the APP1 segment; 1 when absent or unreadable. */
export function exifOrientation(b: Uint8Array): Orientation {
  if (!isJpeg(b)) return 1;
  let result: Orientation = 1;
  walkSegments(b, (marker, start, end) => {
    if (marker !== APP1 || !(b[start + 4] === 0x45 && b[start + 5] === 0x78 && b[start + 6] === 0x69 && b[start + 7] === 0x66)) return;
    const t = start + 10; // TIFF header
    if (t + 8 > end) return false;
    const le = b[t] === 0x49 && b[t + 1] === 0x49;
    const u16 = (o: number) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
    const u32 = (o: number) => (le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
    const ifd = u32(4);
    if (t + ifd + 2 > end) return false;
    const count = u16(ifd);
    for (let k = 0; k < count; k++) {
      const e = ifd + 2 + k * 12;
      if (t + e + 12 > end) break;
      if (u16(e) === 0x0112) {
        const v = u16(e + 8);
        if (v >= 1 && v <= 8) result = v as Orientation;
        break;
      }
    }
    return false;
  });
  return result;
}

/**
 * Removes APP1 (EXIF/XMP: GPS position, camera serials), APP13 (IPTC) and comment segments.
 * Keeps JFIF, ICC profiles (APP2) and the Adobe marker (APP14) that CMYK JPEGs need.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array {
  if (!isJpeg(b)) return b;
  const keep: Array<[number, number]> = [[0, 2]];
  let removed = false;
  const scanStart = walkSegments(b, (marker, start, end) => {
    if (marker === APP1 || marker === APP13 || marker === COM) removed = true;
    else keep.push([start, end]);
  });
  if (!removed) return b;
  keep.push([scanStart, b.length]);
  const out = new Uint8Array(keep.reduce((n, [s, e]) => n + (e - s), 0));
  let o = 0;
  for (const [s, e] of keep) {
    out.set(b.subarray(s, e), o);
    o += e - s;
  }
  return out;
}
