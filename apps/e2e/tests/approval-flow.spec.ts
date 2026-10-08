import { expect, test, type Page } from '@playwright/test';
import { decide, submitDocument } from './flows';
import { expectAccessible, signedIn } from './helpers';

async function statusOf(page: Page, id: string) {
  await page.goto(`/submissions/${id}`);
  return page.getByRole('main');
}

test('a document passes a parallel step, the next approver, then the CFO', async ({ browser }) => {
  const id = await submitDocument(browser, 'E2E_Parallel_Invoice.pdf', /Microtech/);

  // Invariant 1: Meera (position 2) can't see it while position 1 is open, not even by URL
  {
    const { context, page } = await signedIn(browser, 'meera');
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('E2E_Parallel_Invoice.pdf')).toHaveCount(0);
    await page.goto(`/approvals/${id}`);
    await expect(page.getByText(/not found/i).first()).toBeVisible();
    await context.close();
  }

  // Parallel step: one approval is not enough
  await decide(browser, 'priya', id, 'APPROVE', 'Matches the PO');
  const creator = await signedIn(browser, 'rahul');
  await expect(await statusOf(creator.page, id)).toContainText('Pending Approver (Position 1)');
  await decide(browser, 'arjun', id, 'APPROVE');
  await expect(await statusOf(creator.page, id)).toContainText('Pending Approver (Position 2)');

  // A rejection needs a reason: the dialog doesn't open without one
  {
    const { context, page } = await signedIn(browser, 'meera');
    await page.goto(`/approvals/${id}`);
    await expectAccessible(page, 'approver review');
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.getByText('Give a reason before rejecting')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await context.close();
  }
  await decide(browser, 'meera', id, 'APPROVE', 'Budget confirmed');
  await expect(await statusOf(creator.page, id)).toContainText('Pending CFO');

  {
    const { context, page } = await signedIn(browser, 'cfo');
    await page.goto(`/final-approvals/${id}`);
    await expectAccessible(page, 'CFO review');
    await page.getByRole('button', { name: 'Approve & Complete', exact: true }).click();
    await expectAccessible(page, 'CFO confirm dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Approve & Complete' }).click();
    await page.waitForURL('**/final-approvals');
    await context.close();
  }

  const main = await statusOf(creator.page, id);
  await expect(main).toContainText('Completed');
  await expectAccessible(creator.page, 'completed submission');

  // View opens the stored PDF inline in a new tab
  const response = creator.context.waitForEvent('response', (r) =>
    r.url().includes('/local-storage'),
  );
  await creator.page.getByRole('button', { name: 'View' }).click();
  const file = await response;
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('application/pdf');
  expect(file.headers()['content-disposition']).toMatch(/^inline;/);
  await creator.context.close();
});
