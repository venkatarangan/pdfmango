import { describe, expect, it } from 'vitest';
import { analyticsAllowed, type AnalyticsEnv } from '../../src/lib/analytics';

const live: AnalyticsEnv = { hostname: 'pdf.mangoidiots.com', online: true, doNotTrack: null, globalPrivacyControl: undefined, measurementId: 'G-ABC123XYZ' };

describe('analyticsAllowed (Mudalali-style rules)', () => {
  it('runs on the live hostname with a real measurement ID', () => expect(analyticsAllowed(live)).toBe(true));
  it('never on localhost or preview hosts', () => {
    expect(analyticsAllowed({ ...live, hostname: 'localhost' })).toBe(false);
    expect(analyticsAllowed({ ...live, hostname: 'venkatarangan.github.io' })).toBe(false);
  });
  it('skips itself offline, with Do Not Track, or with Global Privacy Control', () => {
    expect(analyticsAllowed({ ...live, online: false })).toBe(false);
    expect(analyticsAllowed({ ...live, doNotTrack: '1' })).toBe(false);
    expect(analyticsAllowed({ ...live, globalPrivacyControl: true })).toBe(false);
  });
  it('stays off while the measurement ID is the placeholder', () => {
    expect(analyticsAllowed({ ...live, measurementId: 'G-XXXXXXXXXX' })).toBe(false);
    expect(analyticsAllowed({ ...live, measurementId: '' })).toBe(false);
  });
});
