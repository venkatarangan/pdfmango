// The start screen's release card shows for a week from the release day, then hides itself.
import { describe, expect, it } from 'vitest';
import { announcementVisible, releaseDate } from '../../src/lib/announcement';

const a = { date: '2026-11-03', days: 7, text: 'New tools.' };

describe('release card', () => {
  it('shows from the release day for a week, in the visitor’s own time', () => {
    expect(announcementVisible(a, new Date(2026, 10, 2, 23, 59))).toBe(false);
    expect(announcementVisible(a, new Date(2026, 10, 3, 0, 0))).toBe(true);
    expect(announcementVisible(a, new Date(2026, 10, 9, 23, 59))).toBe(true);
    expect(announcementVisible(a, new Date(2026, 10, 10, 0, 0))).toBe(false);
  });
  it('shows nothing when there is no text', () => {
    expect(announcementVisible({ ...a, text: '' }, new Date(2026, 10, 4))).toBe(false);
  });
  it('writes the date out in full', () => {
    expect(releaseDate(a)).toBe('3 November 2026');
  });
});
