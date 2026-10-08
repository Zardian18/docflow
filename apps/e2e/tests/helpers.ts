import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page } from '@playwright/test';

// Mirrors apps/api/src/demo/seed.ts
export const DEMO_PASSWORD = 'demo-password-1';
export const PEOPLE = {
  admin: 'Anita Mehta',
  cfo: 'Vikram Malhotra',
  rahul: 'Rahul Mehra',
  sara: 'Sara Khan',
  priya: 'Priya Shah',
  arjun: 'Arjun Nair',
  meera: 'Meera Kulkarni',
  dev: 'Dev Iyer',
  lina: 'Lina Fernandes',
} as const;
export type Person = keyof typeof PEOPLE;

export const emailOf = (who: Person) => `${who}@demo.docflow.test`;
export const authFile = (who: Person) =>
  path.join(import.meta.dirname, '..', '.auth', `${who}.json`);

/** A browser context signed in as `who` (sessions saved once by auth.setup.ts). */
export async function signedIn(browser: Browser, who: Person) {
  const context = await browser.newContext({ storageState: authFile(who) });
  const page = await context.newPage();
  return { context, page };
}

/** A tiny valid PDF, so the upload passes the server's signature check. */
export function pdf(title: string): Buffer {
  const body = `BT /F1 18 Tf 72 720 Td (${title}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

/** WCAG 2.1 A/AA scan of the current page; fails the test with a readable list. */
export async function expectAccessible(page: Page, label: string) {
  // Popovers and dialogs fade in and out; mid-fade text would read as low contrast
  // (endless ones, like a loading pulse, never settle and are ignored)
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = violations.flatMap((v) =>
    v.nodes.map(
      (n) => `${v.id} (${v.impact}): ${n.target.join(' ')} — ${n.any[0]?.message ?? v.help}`,
    ),
  );
  expect(summary, `accessibility violations on ${label}`).toEqual([]);
}

/** Collects CSP violations and console errors; call `assertClean()` at the end of a test. */
export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    // 401 from /me before signing in is expected
    if (m.type() === 'error' && !/status of 401/.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return { assertClean: () => expect(problems, 'console errors').toEqual([]) };
}
