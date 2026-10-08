import { expect, test } from '@playwright/test';
import { decide, submitDocument } from './flows';
import { expectAccessible, signedIn } from './helpers';

test('a rejection ends the chain at once and the CFO still sees it (invariant 5, D22)', async ({
  browser,
}) => {
  const id = await submitDocument(browser, 'E2E_Rejected_Invoice.pdf', /Orbit/);
  await decide(browser, 'dev', id, 'REJECT', 'Vendor GSTIN missing');

  // The Creator sees who rejected it and why
  {
    const { context, page } = await signedIn(browser, 'rahul');
    await page.goto(`/submissions/${id}`);
    const main = page.getByRole('main');
    await expect(main).toContainText('Rejected');
    await expect(main).toContainText('Rejected by Dev Iyer');
    await expect(main).toContainText('Vendor GSTIN missing');
    await context.close();
  }

  // Lina (position 2) was skipped: it never appears for her, even by URL
  {
    const { context, page } = await signedIn(browser, 'lina');
    await page.goto(`/approvals/${id}`);
    await expect(page.getByText(/not found/i).first()).toBeVisible();
    await context.close();
  }

  // The CFO finds it under "Rejected before final approval", read-only
  {
    const { context, page } = await signedIn(browser, 'cfo');
    await page.goto('/final-approvals');
    await page.getByRole('tab', { name: /Rejected before final approval/ }).click();
    await expect(page).toHaveURL(/view=rejected/);
    await expectAccessible(page, 'CFO rejected-before tab');
    const row = page.getByRole('link', { name: 'E2E_Rejected_Invoice.pdf' });
    await expect(row).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Vendor GSTIN missing');
    await row.click();
    await page.waitForURL(`**/final-approvals/${id}`);
    await expect(page.getByRole('main')).toContainText('before it reached you');
    await expect(page.getByRole('button', { name: 'Approve & Complete' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toHaveCount(0);
    await context.close();
  }
});
