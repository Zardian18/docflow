import { describe, expect, it } from 'vitest';
import { dayCount, heldClock, instantForLocalDate, localDay, sinceClock } from './clock.js';

const at = (s: string) => new Date(s);

describe('Tracker C: time a team has held a task (Q50)', () => {
  it('matches the owner’s example: day 1, three days with Regulation, a day of rework = 2 days', () => {
    // Materials drafts on day 1 (09:00–17:00) and sends it; Regulation has it for 3 days and
    // returns it on day 4 at 17:00; Materials reworks and resubmits on day 5 at 16:00
    const materials = [
      { startedAt: at('2026-10-01T03:30:00Z'), endedAt: at('2026-10-01T11:30:00Z') },
      { startedAt: at('2026-10-04T11:30:00Z'), endedAt: at('2026-10-05T10:30:00Z') },
    ];
    expect(heldClock(materials, at('2026-10-06T00:00:00Z'))).toEqual({
      days: 2,
      since: '2026-10-01T03:30:00.000Z',
    });
  });

  it('counts an open interval up to now, rounds any started day up, and is empty with no intervals', () => {
    const now = at('2026-10-02T12:00:00Z');
    expect(heldClock([{ startedAt: at('2026-10-02T11:00:00Z'), endedAt: null }], now)!.days).toBe(
      1,
    );
    expect(heldClock([{ startedAt: at('2026-09-30T12:00:00Z'), endedAt: null }], now)!.days).toBe(
      2,
    );
    expect(heldClock([], now)).toBeNull();
  });
});

describe('Trackers A and B: calendar days in India time (Q51)', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    // 23:00 IST on the 1st to 01:00 IST on the 2nd is one calendar day later
    expect(sinceClock(at('2026-10-01T17:30:00Z'), at('2026-10-01T19:30:00Z'))!.days).toBe(1);
    expect(sinceClock(at('2026-10-01T05:00:00Z'), at('2026-10-01T15:00:00Z'))!.days).toBe(0);
    expect(sinceClock(null)).toBeNull();
  });

  it('turns a logged date into a moment, refusing the future', () => {
    const now = at('2026-10-10T06:00:00Z');
    expect(instantForLocalDate(undefined, now)).toBe(now);
    expect(instantForLocalDate(localDay(now), now)).toBe(now);
    expect(instantForLocalDate('2026-10-03', now).toISOString()).toBe('2026-10-02T18:30:00.000Z');
    expect(() => instantForLocalDate('2026-10-11', now)).toThrow();
  });

  it('counts component days: running until the end date is filled in, then fixed (D27)', () => {
    const now = at('2026-10-21T06:00:00Z');
    expect(dayCount('2026-10-01', null, now)).toEqual({ days: 20, running: true });
    expect(dayCount('2026-10-01', '2026-10-05', now)).toEqual({ days: 4, running: false });
    expect(dayCount(null, '2026-10-05', now)).toBeNull();
    // An end before the start (a typing mistake) never shows negative days
    expect(dayCount('2026-10-05', '2026-10-01', now)).toEqual({ days: 0, running: false });
  });
});
