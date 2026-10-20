import { describe, expect, it } from 'vitest';
import {
  EXPORT_ORDER_V1,
  MAX_UPLOAD_BYTES,
  mimeForFileName,
  PresignRequest,
  slotProblems,
  TEMPLATES,
  templateProblems,
  type Template,
} from './index.js';

describe('workflow templates', () => {
  it.each(TEMPLATES.map((t) => [`${t.key} v${t.version}`, t] as const))(
    '%s is structurally sound',
    (_name, template) => {
      expect(templateProblems(template)).toEqual([]);
    },
  );

  it('catches a dependency on a later step and an unknown rejection target', () => {
    const broken: Template = {
      ...EXPORT_ORDER_V1,
      steps: EXPORT_ORDER_V1.steps.map((s) =>
        s.key === 'cbm'
          ? { ...s, after: ['pi'] }
          : s.key === 'pi_approval'
            ? { ...s, onReject: { reopen: 'delivered' } }
            : s,
      ) as Template['steps'],
    };
    const problems = templateProblems(broken);
    expect(problems.some((p) => p.startsWith('cbm: pi must come before it'))).toBe(true);
    expect(problems.some((p) => p.startsWith('pi_approval: rejection must reopen'))).toBe(true);
  });

  it('follows the reviewed flow: the BoL is requested only after sailing (D24)', () => {
    const step = (k: string) => EXPORT_ORDER_V1.steps.find((s) => s.key === k)!;
    expect(step('sailed').after).toEqual(['payment_check']);
    expect(step('bol_requested').after).toEqual(['sailed']);
    expect(step('delivered').after).toEqual(['bol_sent']);
    expect(step('packaging').after).toEqual(['annexure', 'artwork']);
  });

  it('keeps the two PI versions apart', () => {
    const access = EXPORT_ORDER_V1.docAccess;
    for (const team of ['REGULATION', 'MATERIALS', 'DESIGN'] as const) {
      expect(access.PI_FULL).not.toContain(team);
      expect(access.PI_NO_RATES).toContain(team);
    }
    for (const team of ['LOGISTICS', 'ACCOUNTS', 'PRODUCTION'] as const) {
      expect(access.PI_FULL).toContain(team);
    }
  });
});

describe('named slots (Q6)', () => {
  const full = (overrides: Record<string, string[]> = {}) =>
    (
      [
        ['MARKETING', ['m']],
        ['CREATOR', ['c']],
        ['PI_APPROVER', ['a']],
        ['PI_HEAD', ['h1', 'h2']],
        ['PAY_APPROVER', ['a']],
        ['PAY_HEAD', ['h1']],
        ['BOL_APPROVER', ['a']],
        ['BOL_HEAD', ['h2']],
      ] as const
    ).map(([slot, ids]) => ({ slot, employeeIds: overrides[slot] ?? [...ids] }));

  it('accepts the same person across different chains', () => {
    expect(slotProblems(full(), { requireAll: true })).toEqual({});
  });

  it('refuses one person twice in a chain, the Creator approving, and gaps', () => {
    expect(slotProblems(full({ PI_HEAD: ['a'] }), { requireAll: true }).PI_HEAD).toMatch(
      /twice in the same chain/,
    );
    expect(slotProblems(full({ PAY_APPROVER: ['c'] }), { requireAll: true }).PAY_APPROVER).toMatch(
      /Creator/,
    );
    expect(slotProblems(full({ MARKETING: ['c'] }), { requireAll: true }).MARKETING).toMatch(
      /Creator/,
    );
    expect(slotProblems(full({ BOL_HEAD: [] }), { requireAll: true }).BOL_HEAD).toBe(
      'Choose someone',
    );
    expect(slotProblems(full({ MARKETING: ['m', 'x'] }), { requireAll: true }).MARKETING).toBe(
      'Choose one person',
    );
    expect(slotProblems(full({ BOL_HEAD: [] }), { requireAll: false }).BOL_HEAD).toBeUndefined();
  });
});

describe('uploads (Q63)', () => {
  it('accepts PDF, Word, Excel, JPG and PNG up to 20 MB', () => {
    for (const name of ['a.pdf', 'a.docx', 'a.xlsx', 'a.jpg', 'a.jpeg', 'a.png']) {
      const mime = mimeForFileName(name)!;
      expect(
        PresignRequest.safeParse({ fileName: name, contentType: mime, size: MAX_UPLOAD_BYTES })
          .success,
        name,
      ).toBe(true);
    }
    expect(mimeForFileName('a.exe')).toBeNull();
    expect(
      PresignRequest.safeParse({
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        size: MAX_UPLOAD_BYTES + 1,
      }).success,
    ).toBe(false);
  });
});
