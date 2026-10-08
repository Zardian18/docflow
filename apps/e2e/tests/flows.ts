import { expect, type Browser } from '@playwright/test';
import { expectAccessible, pdf, signedIn, watchConsole, type Person } from './helpers';

/** Creator uploads and submits a PDF to a company, keeping its default chain. */
export async function submitDocument(browser: Browser, fileName: string, company: RegExp) {
  const { context, page } = await signedIn(browser, 'rahul');
  const consoleWatch = watchConsole(page);
  await page.goto('/submit');
  await page.locator('input[type=file]').setInputFiles({
    name: fileName,
    mimeType: 'application/pdf',
    buffer: pdf(fileName),
  });
  await expect(page.getByText('Uploaded')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('combobox').first().click();
  await page.getByPlaceholder('Company name or code').fill(company.source.slice(0, 4));
  await page.getByRole('option', { name: company }).click();
  await page.getByLabel('Invoice number').fill('E2E-0001');
  await expectAccessible(page, 'new submission (filled in)');
  await page.getByRole('button', { name: 'Submit for Approval' }).click();
  await page.waitForURL(/\/submissions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = page.url().split('/').pop()!;
  consoleWatch.assertClean();
  await context.close();
  return id;
}

/** Opens the review screen from the pending list and records a decision through the dialog. */
export async function decide(
  browser: Browser,
  who: Person,
  id: string,
  decision: 'APPROVE' | 'REJECT',
  remarks?: string,
) {
  const cfo = who === 'cfo';
  const base = cfo ? '/final-approvals' : '/approvals';
  const { context, page } = await signedIn(browser, who);
  await page.goto(base);
  await page.locator(`a[href="${base}/${id}"]`).first().click();
  await page.waitForURL(`**${base}/${id}`);
  if (remarks) await page.getByLabel(/Remarks/).fill(remarks);
  const action = decision === 'REJECT' ? 'Reject' : cfo ? 'Approve & Complete' : 'Approve';
  await page.getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await page.waitForURL(`**${base}`);
  await context.close();
}
