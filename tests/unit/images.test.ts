import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { exifOrientation, stripJpegMetadata, type Orientation } from '../../src/worker/jpeg';
import { A4, imagePageLayout, orientedMatrix } from '../../src/worker/layout';

const fixture = (f: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${f}`, import.meta.url)));

describe('EXIF orientation', () => {
  it.each([
    ['phone-portrait-exif6.jpg', 6],
    ['phone-portrait-exif8.jpg', 8],
    ['phone-landscape-exif1.jpg', 1],
    ['phone-landscape-exif3.jpg', 3],
  ])('%s -> %i', (f, o) => expect(exifOrientation(fixture(f))).toBe(o));

  it('handles little-endian TIFF headers', () => {
    // SOI, APP1 "Exif\0\0" "II*\0" offset 8, 1 entry: 0x0112 SHORT 1 value 8
    const tiff = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, payload.length + 2, ...payload, 0xff, 0xda, 0, 2]);
    expect(exifOrientation(jpg)).toBe(8);
  });
  it('returns 1 for PNG or JPEG without EXIF', () => {
    expect(exifOrientation(fixture('plain.png'))).toBe(1);
    expect(exifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
  });
});

describe('stripJpegMetadata', () => {
  it('removes the EXIF segment and nothing else', () => {
    const src = fixture('phone-portrait-exif6.jpg');
    const out = stripJpegMetadata(src);
    expect(exifOrientation(out)).toBe(1);
    expect(src.length - out.length).toBeGreaterThan(20);
    expect(src.length - out.length).toBeLessThan(200);
    // Everything from the first non-APP1 segment on is byte-identical.
    expect(Buffer.from(out.subarray(-1000)).equals(Buffer.from(src.subarray(-1000)))).toBe(true);
    expect([out[0], out[1]]).toEqual([0xff, 0xd8]);
  });
  it('keeps APP0, APP2 (ICC) and APP14 (Adobe) segments', () => {
    const seg = (m: number, n: number) => [0xff, m, 0, n + 2, ...new Array(n).fill(7)];
    const jpg = new Uint8Array([0xff, 0xd8, ...seg(0xe0, 4), ...seg(0xe1, 6), ...seg(0xe2, 3), ...seg(0xee, 5), ...seg(0xfe, 2), 0xff, 0xda, 0, 2, 9, 9]);
    const out = stripJpegMetadata(jpg);
    expect([...out]).toEqual([0xff, 0xd8, ...seg(0xe0, 4), ...seg(0xe2, 3), ...seg(0xee, 5), 0xff, 0xda, 0, 2, 9, 9]);
  });
  it('returns the same array when there is nothing to strip', () => {
    const png = fixture('plain.png');
    expect(stripJpegMetadata(png)).toBe(png);
  });
});

/** Applies a PDF matrix to a point. */
const apply = (m: number[], [u, v]: [number, number]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]].map((n) => Math.round(n * 1000) / 1000);

describe('orientedMatrix', () => {
  // Stored image's top-left pixel is at unit-square point (0, 1). Where must it land (x=10,y=20,w=100,h=50)?
  const rect = [10, 20, 100, 50] as const;
  const topLeft = { left: 10, right: 110, bottom: 20, top: 70 };
  it.each<[Orientation, [number, number]]>([
    [1, [topLeft.left, topLeft.top]],
    [2, [topLeft.right, topLeft.top]],
    [3, [topLeft.right, topLeft.bottom]],
    [4, [topLeft.left, topLeft.bottom]],
    [5, [topLeft.left, topLeft.top]],
    [6, [topLeft.right, topLeft.top]],
    [7, [topLeft.right, topLeft.bottom]],
    [8, [topLeft.left, topLeft.bottom]],
  ])('orientation %i puts the stored top-left corner at %j', (o, expected) => {
    expect(apply(orientedMatrix(o, ...rect), [0, 1])).toEqual(expected);
  });
  it('always covers exactly the target rectangle', () => {
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8] as Orientation[]) {
      const m = orientedMatrix(o, ...rect);
      const pts = ([[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][]).map((p) => apply(m, p));
      expect(Math.min(...pts.map((p) => p[0]))).toBe(10);
      expect(Math.max(...pts.map((p) => p[0]))).toBe(110);
      expect(Math.min(...pts.map((p) => p[1]))).toBe(20);
      expect(Math.max(...pts.map((p) => p[1]))).toBe(70);
    }
  });
});

describe('imagePageLayout', () => {
  it('A4 follows the image orientation and touches the edges with no margin', () => {
    const l = imagePageLayout({ widthPx: 4000, heightPx: 3000, xRes: 72, yRes: 72 }, 'A4', 0);
    expect([l.pageW, l.pageH]).toEqual([A4[1], A4[0]]);
    expect(l.y).toBeCloseTo(0); // 4:3 on landscape A4 is limited by height
    expect(l.x).toBeCloseTo((A4[1] - l.w) / 2);
    const p = imagePageLayout({ widthPx: 3000, heightPx: 4000, xRes: 72, yRes: 72 }, 'A4', 0);
    expect([p.pageW, p.pageH]).toEqual(A4);
  });
  it('A4 keeps the margin on the limiting axis', () => {
    const l = imagePageLayout({ widthPx: 4000, heightPx: 3000, xRes: 72, yRes: 72 }, 'A4', 36);
    expect(l.y).toBeCloseTo(36);
    expect(l.h).toBeCloseTo(A4[0] - 72);
    expect(l.w / l.h).toBeCloseTo(4 / 3);
  });
  it('original size uses the image resolution, 96 ppi when it has none', () => {
    expect(imagePageLayout({ widthPx: 1600, heightPx: 1200, xRes: 72, yRes: 72 }, 'original', 0)).toMatchObject({ pageW: 1600, pageH: 1200 });
    expect(imagePageLayout({ widthPx: 960, heightPx: 480, xRes: 0, yRes: NaN }, 'original', 18)).toMatchObject({ pageW: 720 + 36, pageH: 360 + 36, x: 18, y: 18 });
    expect(imagePageLayout({ widthPx: 300, heightPx: 300, xRes: 300, yRes: 300 }, 'original', 0)).toMatchObject({ pageW: 72, pageH: 72 });
  });
});
