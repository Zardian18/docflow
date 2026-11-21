import { describe, expect, it } from 'vitest';
import {
  CURRENT_TEMPLATE,
  EXPORT_ORDER_V1,
  EXPORT_ORDER_V3,
  EXPORT_ORDER_V4,
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

  it('v4 asks for the PI without rates only after the PI with rates is approved (D32)', () => {
    const step = (k: string) => EXPORT_ORDER_V4.steps.find((s) => s.key === k)!;
    const pi = step('pi');
    const chain = step('pi_approval');
    const noRates = step('pi_no_rates');
    expect(pi.kind === 'TASK' && pi.docs).toEqual([{ kind: 'PI_FULL', required: true }]);
    expect(chain.kind === 'APPROVAL_CHAIN' && chain.docToApprove).toEqual(['PI_FULL']);
    expect(noRates.after).toEqual(['pi_approval']);
    expect(noRates.kind === 'TASK' && noRates.actor).toEqual({ slot: 'CREATOR' });
    expect(noRates.kind === 'TASK' && noRates.docs).toEqual([
      { kind: 'PI_NO_RATES', required: true },
    ]);
    expect(step('advance_requested').after).toEqual(['pi_no_rates']);
    expect(CURRENT_TEMPLATE).toBe(EXPORT_ORDER_V4);
    // Older versions stay as they were for the orders pinned to them
    const v3pi = EXPORT_ORDER_V3.steps.find((s) => s.key === 'pi')!;
    expect(v3pi.kind === 'TASK' && v3pi.docs?.map((d) => d.kind)).toEqual([
      'PI_FULL',
      'PI_NO_RATES',
    ]);
  });
});

describe('named slots (D26)', () => {
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

  it('lets one person fill several slots of the same chain, the Creator included', () => {
    expect(
      slotProblems(full({ MARKETING: ['c'], PI_APPROVER: ['c'], PI_HEAD: ['c', 'h1'] }), {
        requireAll: true,
      }),
    ).toEqual({});
  });

  it('refuses gaps, two people in a one-person slot, and a person listed twice', () => {
    expect(slotProblems(full({ PI_HEAD: ['h1', 'h1'] }), { requireAll: true }).PI_HEAD).toBe(
      'A person is listed twice',
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
