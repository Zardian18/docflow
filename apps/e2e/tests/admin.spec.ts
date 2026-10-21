import { expect, test } from '@playwright/test';
import { expectAccessible, signedIn } from './helpers';

test('Admin: a person in several teams, a buyer with its default chain and ALL/ANY', async ({
  browser,
}) => {
  const { context, page } = await signedIn(browser, 'admin');

  await page.goto('/admin/employees');
  await page.getByRole('button', { name: 'Add Employee' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('Esha Two Teams');
  await dialog.getByLabel('Email').fill('esha@demo.docflow.test');
  const teams = dialog.getByRole('group', { name: 'Teams' });
  await teams.getByLabel('Regulation').check();
  await teams.getByLabel('Production').check();
  await dialog
    .getByRole('group', { name: 'Can be named as' })
    .getByLabel(/^Approver/)
    .check();
  await expectAccessible(page, 'employee dialog');
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('dialog', { name: /Password link for Esha/ })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  const row = page.getByRole('row', { name: /Esha Two Teams/ }).filter({ visible: true });
  await expect(row).toContainText('Regulation, Production');

  // The buyer is the company, and holds the default chain (D27)
  await page.goto('/admin/buyers');
  await page
    .getByRole('link', { name: /Add Buyer/i })
    .first()
    .click();
  await page.getByLabel('Buyer (company) name').fill('Lagos Pharmacy Ltd');
  await page.getByLabel('Country (optional)').fill('Nigeria');
  await page.getByRole('combobox', { name: /^Marketing:/ }).click();
  await page.getByPlaceholder('Search by name').fill('Rohan');
  await page.getByRole('option', { name: /Rohan Kapoor/ }).click();
  await page.getByRole('combobox', { name: /PI Head Approver: who must approve/ }).click();
  await page.getByRole('option', { name: 'Any one of them is enough' }).click();
  await expectAccessible(page, 'buyer form');
  await page.getByRole('button', { name: 'Add buyer' }).click();
  await page.waitForURL('**/admin/buyers');
  await expect(
    page.getByRole('row', { name: /Lagos Pharmacy Ltd/ }).filter({ visible: true }),
  ).toBeVisible();
  await context.close();

  // Marketing sees the chain but can't change it
  const rohan = await signedIn(browser, 'rohan');
  await rohan.page.goto('/admin/buyers');
  await rohan.page
    .getByRole('link', { name: 'Edit Lagos Pharmacy Ltd' })
    .filter({ visible: true })
    .click();
  await expect(rohan.page.getByText('Only Admin changes the default chain.')).toBeVisible();
  await expect(rohan.page.getByRole('combobox', { name: /^Marketing:/ })).toHaveCount(0);
  await rohan.context.close();
});
