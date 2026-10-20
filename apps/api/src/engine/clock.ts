/**
 * The three day-counters (D24). Days are calendar days in India time (Q51); instants are
 * stored in UTC (invariant 9) and only converted for counting and display.
 */
export const TIME_ZONE = 'Asia/Kolkata';
const DAY_MS = 86_400_000;

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD of an instant, in India time */
export const localDay = (at: Date) => dayFormat.format(at);

/** Whole calendar days from one India-time date to another */
function daysBetweenLocal(fromDay: string, toDay: string) {
  return Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS,
  );
}

/** Trackers A and B: calendar days since the anchor, with the anchor itself */
export function sinceClock(since: Date | null, now = new Date()) {
  if (!since) return null;
  return {
    days: Math.max(0, daysBetweenLocal(localDay(since), localDay(now))),
    since: since.toISOString(),
  };
}

/**
 * The moment a logged date stands for: now when it's today, otherwise the start of that day
 * in India time. Refuses future dates.
 */
export function instantForLocalDate(day: string | undefined, now = new Date()): Date {
  if (!day || day === localDay(now)) return now;
  if (day > localDay(now)) throw new RangeError('future');
  return new Date(`${day}T00:00:00+05:30`);
}

export interface Interval {
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * Tracker C (Q50): total time a holder has had a task, rounded up to whole days. In the
 * owner's example (day 1 with Materials, three days with Regulation, then a day of rework)
 * Materials shows 2 days: the time with Regulation isn't counted.
 */
export function heldClock(intervals: Interval[], now = new Date()) {
  if (intervals.length === 0) return null;
  const ms = intervals.reduce(
    (sum, i) => sum + Math.max(0, (i.endedAt ?? now).getTime() - i.startedAt.getTime()),
    0,
  );
  const first = intervals.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
  return { days: Math.ceil(ms / DAY_MS), since: first.startedAt.toISOString() };
}

/** Days since a calendar date (component rows: days since PO date) */
export function daysSinceDate(day: string | null, now = new Date()) {
  if (!day) return null;
  return Math.max(0, daysBetweenLocal(day, localDay(now)));
}
