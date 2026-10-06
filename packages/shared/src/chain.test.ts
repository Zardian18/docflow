import { describe, expect, it } from 'vitest';
import { groupBySteps, normalizePositions, validateChain } from './chain.js';
import { CompanyUpsert, Email, EmployeeCreate, Password } from './index.js';

const e = (employeeId: string, position: number) => ({ employeeId, position });

describe('validateChain', () => {
  it('accepts two sequential approvers', () => {
    expect(validateChain([e('a', 1), e('b', 2)])).toEqual([]);
  });

  it('accepts a parallel group (shared step number)', () => {
    expect(validateChain([e('a', 1), e('b', 1)])).toEqual([]);
  });

  it('requires at least two approvers', () => {
    expect(validateChain([e('a', 1)])).toContainEqual({ code: 'TOO_FEW_APPROVERS', min: 2 });
    expect(validateChain([])).toContainEqual({ code: 'TOO_FEW_APPROVERS', min: 2 });
  });

  it('rejects the same employee twice', () => {
    expect(validateChain([e('a', 1), e('a', 2)])).toContainEqual({
      code: 'DUPLICATE_APPROVER',
      employeeId: 'a',
    });
  });

  it('rejects non-positive or fractional steps', () => {
    expect(validateChain([e('a', 0), e('b', 1.5)])).toEqual([
      { code: 'INVALID_POSITION', employeeId: 'a' },
      { code: 'INVALID_POSITION', employeeId: 'b' },
    ]);
  });
});

describe('normalizePositions', () => {
  it('renumbers densely and keeps parallel groups', () => {
    const out = normalizePositions([e('a', 1), e('b', 1), e('c', 3), e('d', 7)]);
    expect(out.map((x) => x.position)).toEqual([1, 1, 2, 3]);
  });

  it('sorts by step and keeps input order within a step', () => {
    const out = normalizePositions([e('c', 5), e('a', 2), e('b', 2)]);
    expect(out.map((x) => x.employeeId)).toEqual(['a', 'b', 'c']);
  });
});

describe('groupBySteps', () => {
  it('groups by step in order', () => {
    const groups = groupBySteps([e('a', 1), e('b', 2), e('c', 2)]);
    expect(groups.map((g) => g.map((x) => x.employeeId))).toEqual([['a'], ['b', 'c']]);
  });
});

describe('field schemas', () => {
  it('normalises email case and whitespace', () => {
    expect(Email.parse('  A.Mehta@Example.COM ')).toBe('a.mehta@example.com');
  });

  it('enforces the 12-character password minimum', () => {
    expect(Password.safeParse('short').success).toBe(false);
    expect(Password.safeParse('a'.repeat(12)).success).toBe(true);
  });

  it('uppercases codes and turns blanks into null', () => {
    const base = { name: 'X', email: 'x@y.co', roleId: '6f1a8d2e-3b4c-4d5e-8f90-123456789abc' };
    expect(EmployeeCreate.parse({ ...base, employeeCode: ' emp-1 ' }).employeeCode).toBe('EMP-1');
    expect(EmployeeCreate.parse({ ...base, employeeCode: '' }).employeeCode).toBeNull();
    expect(CompanyUpsert.parse({ name: 'Microtech', code: 'mic', approvers: [] }).code).toBe('MIC');
  });
});
