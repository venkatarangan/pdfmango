// The start screen's release card: when it shows, and how its date reads.
export type Announcement = { date: string; days: number; text: string };

/** Midnight at the start of a YYYY-MM-DD day, in the visitor's own time zone. */
function startOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** True from the release day until `days` days later (the visitor's own calendar). */
export function announcementVisible(a: Announcement, now: Date = new Date()): boolean {
  if (!a.text) return false;
  const from = startOf(a.date);
  const until = new Date(from.getFullYear(), from.getMonth(), from.getDate() + a.days);
  return now >= from && now < until;
}

/** "3 November 2026". */
export function releaseDate(a: Announcement): string {
  return startOf(a.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
