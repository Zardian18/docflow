import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  parseFilters,
  toApiQuery,
  toSearchParams,
} from './filters';

const ID = '6f1a8d2e-3b4c-4d5e-8f90-123456789abc';

describe('dashboard filters in the URL', () => {
  it('round-trips every filter', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      status: 'PENDING_APPROVER' as const,
      position: 2,
      companyId: ID,
      companyName: 'Acme',
      createdBy: ID,
      createdByName: 'R. Shah',
      from: '2026-09-01',
      to: '2026-09-30',
      q: 'invoice',
      sort: 'company' as const,
      dir: 'asc' as const,
      page: 3,
    };
    expect(parseFilters(toSearchParams(filters))).toEqual(filters);
  });

  it('keeps plain /admin clean when nothing is filtered', () => {
    expect(toSearchParams(DEFAULT_FILTERS).toString()).toBe('');
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it('ignores malformed values instead of failing', () => {
    const f = parseFilters(
      new URLSearchParams('status=NOPE&page=-2&from=yesterday&companyId=x&sort=evil&position=2'),
    );
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it('only keeps a position for documents pending with an approver', () => {
    expect(
      parseFilters(new URLSearchParams('status=PENDING_CFO&position=2')).position,
    ).toBeUndefined();
  });

  it('turns local dates into whole-day instants for the API', () => {
    const q = toApiQuery({ ...DEFAULT_FILTERS, from: '2026-09-01', to: '2026-09-01' });
    expect(new Date(q.submittedFrom!).getTime()).toBe(new Date(2026, 8, 1, 0, 0, 0, 0).getTime());
    expect(new Date(q.submittedTo!).getTime()).toBe(
      new Date(2026, 8, 1, 23, 59, 59, 999).getTime(),
    );
  });
});
