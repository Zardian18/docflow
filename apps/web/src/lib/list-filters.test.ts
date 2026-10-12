import { describe, expect, it } from 'vitest';
import {
  dayEnd,
  dayStart,
  listFilterParams,
  parseListFilters,
  STATUS_CHOICES,
} from './list-filters';

const SPEC = {
  sorts: [
    { value: 'submitted', label: 'Submitted', kind: 'date' },
    { value: 'document', label: 'Document', kind: 'text' },
  ],
  defaultSort: 'submitted',
  defaultDir: 'desc',
  statuses: STATUS_CHOICES,
} as const;

describe('list filters in the URL', () => {
  it('reads valid values and ignores malformed ones', () => {
    const f = parseListFilters(
      new URLSearchParams(
        'status=REJECTED&companyId=not-a-uuid&from=2026-10-01&to=yesterday&q=%20acme%20&sort=amount&dir=up&page=-2&decision=APPROVED',
      ),
      SPEC,
    );
    expect(f).toEqual({
      status: 'REJECTED',
      decision: undefined, // this list has no decision filter
      companyId: undefined,
      from: '2026-10-01',
      to: undefined,
      q: 'acme',
      sort: 'submitted',
      dir: 'desc',
      page: 1,
    });
  });

  it('writes only what differs from the defaults, and round-trips', () => {
    const f = { sort: 'document', dir: 'asc' as const, page: 2, status: 'COMPLETED' };
    const params = listFilterParams(f, SPEC);
    expect(params.toString()).toBe('status=COMPLETED&sort=document&dir=asc&page=2');
    expect(parseListFilters(params, SPEC)).toMatchObject(f);
    expect(listFilterParams({ sort: 'submitted', dir: 'desc', page: 1 }, SPEC).toString()).toBe('');
  });

  it('turns local dates into the start and end of those days', () => {
    expect(new Date(dayStart('2026-10-12')!).getHours()).toBe(0);
    expect(new Date(dayEnd('2026-10-12')!).getHours()).toBe(23);
    expect(dayStart(undefined)).toBeUndefined();
  });
});
