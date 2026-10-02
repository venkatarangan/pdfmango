import { describe, expect, it } from 'vitest';
import { CHOICES, DEFAULTS, cleanCredit, diff, merge, sanitizeOverrides } from '../../src/lib/settings';

describe('settings', () => {
  it('defaults come from the config', () => {
    expect(DEFAULTS).toMatchObject({ creditLine: 'Exported with pdf.mangoidiots.com', respectOwnerRestrictions: true, desktopMaxMB: 250, mobileMaxMB: 50, imageDefaultSize: 'A4', imageDefaultMargin: 'none', marginSmallPt: 18, marginMediumPt: 36 });
    expect(DEFAULTS.balanced).toEqual({ ppi: 150, jpegQuality: 75, subsetFonts: true });
  });
  it('every default is one of the choices', () => {
    expect(CHOICES.desktopMaxMB).toContain(DEFAULTS.desktopMaxMB);
    expect(CHOICES.scanPpi).toContain(DEFAULTS.scan.ppi);
  });
  it('keeps valid overrides and drops anything else', () => {
    const raw = {
      desktopMaxMB: 150, mobileMaxMB: 9999, imageDefaultSize: 'letter', imageDefaultMargin: 'small',
      balanced: { ppi: 200, jpegQuality: 1, subsetFonts: 'yes' }, scan: 'x', respectOwnerRestrictions: 'false', evil: '<script>',
    };
    expect(sanitizeOverrides(raw)).toEqual({ desktopMaxMB: 150, imageDefaultMargin: 'small', balanced: { ppi: 200, jpegQuality: 75, subsetFonts: true } });
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides('[]')).toEqual({});
  });
  it('cleans the credit line', () => {
    expect(cleanCredit('  Made\n with\tlove  ')).toBe('Made with love');
    expect(cleanCredit('x'.repeat(300))).toHaveLength(100);
    expect(cleanCredit(42)).toBe('');
    expect(sanitizeOverrides({ creditLine: '' })).toEqual({ creditLine: '' });
  });
  it('stores only differences from the defaults', () => {
    expect(diff(DEFAULTS)).toEqual({});
    const s = merge({ strong: { ppi: 72, jpegQuality: 55, subsetFonts: true } });
    expect(diff(s)).toEqual({ strong: { ppi: 72, jpegQuality: 55, subsetFonts: true } });
    expect(merge({}).scan).toEqual(DEFAULTS.scan);
  });
});
