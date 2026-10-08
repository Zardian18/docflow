import { expect, test } from '@playwright/test';
import { expectAccessible, signedIn } from './helpers';

test('the Admin filters the dashboard and reassigns a pending step (D7, D9)', async ({
  browser,
}) => {
  const { context, page } = await signedIn(browser, 'admin');
  await page.goto('/admin');
  await expect(page.getByText('Total Workflows')).toBeVisible();
  await expectAccessible(page, 'admin dashboard');

  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Completed' }).click();
  await expect(page).toHaveURL(/status=/);
  await expect(page.getByRole('main')).toContainText('Annual_Audit_Fees.pdf');
  await expect(page.getByRole('main')).not.toContainText('Q3_Vendor_Invoice.pdf');
  await page.getByRole('button', { name: 'Clear filters' }).click();

  // The seeded Q3 invoice waits on Priya and Arjun (parallel step 1)
  await page.getByLabel('Search documents').fill('Q3_Vendor');
  await page.getByText('Q3_Vendor_Invoice.pdf').first().click();
  await page.waitForURL('**/admin/workflows/**');
  await expect(page.getByText('Activity log')).toBeVisible();
  await expectAccessible(page, 'admin document page');

  await page.getByRole('button', { name: /^Reassign .*Priya Shah/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Reassign step' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose who takes over');
  await expectAccessible(page, 'reassign dialog');
  await dialog.getByRole('combobox').click();
  await page.getByPlaceholder('Search approvers by name').fill('Lina');
  await page.getByRole('option', { name: /Lina Fernandes/ }).click();
  await dialog.getByLabel(/Reason/).fill('On leave this week');
  await dialog.getByRole('button', { name: 'Reassign step' }).click();
  await expect(
    page.getByText(/Reassigned position 1 from Priya Shah to Lina Fernandes: “On leave this week”/),
  ).toBeVisible();
  await context.close();

  // Lina now has it in her queue; Priya no longer does
  const lina = await signedIn(browser, 'lina');
  await lina.page.goto('/approvals');
  await expect(
    lina.page.getByText('Q3_Vendor_Invoice.pdf').filter({ visible: true }).first(),
  ).toBeVisible();
  await lina.context.close();
  const priya = await signedIn(browser, 'priya');
  await priya.page.goto('/approvals');
  await expect(priya.page.getByRole('main')).not.toContainText('Q3_Vendor_Invoice.pdf');
  await priya.context.close();
});
