import { describe, expect, it } from 'vitest';
import { dayEnd, dayStart } from './list-filters';

describe('list date filters', () => {
  it('turns local dates into the start and end of those days', () => {
    expect(new Date(dayStart('2026-10-12')!).getHours()).toBe(0);
    expect(new Date(dayEnd('2026-10-12')!).getHours()).toBe(23);
    expect(dayStart(undefined)).toBeUndefined();
  });
});
