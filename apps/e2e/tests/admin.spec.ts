import { expect, test } from '@playwright/test';
import { expectAccessible, signedIn } from './helpers';

test('Admin: a person in several teams, a company with ALL/ANY, a buyer', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'admin');

  await page.goto('/admin/employees');
  await page.getByRole('button', { name: 'Add Employee' }).click();
  let dialog = page.getByRole('dialog');
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

  await page.goto('/admin/companies');
  await page
    .getByRole('link', { name: /Add company/i })
    .first()
    .click();
  await page.getByLabel('Company name').fill('Trident Exports Nepal');
  await page.getByRole('combobox', { name: /^Marketing:/ }).click();
  await page.getByPlaceholder('Search by name').fill('Rohan');
  await page.getByRole('option', { name: /Rohan Kapoor/ }).click();
  await page.getByRole('combobox', { name: /PI Head Approver: who must approve/ }).click();
  await page.getByRole('option', { name: 'Any one of them is enough' }).click();
  await expectAccessible(page, 'company form');
  await page.getByRole('button', { name: 'Add company' }).click();
  await page.waitForURL('**/admin/companies');
  await expect(
    page.getByText('Trident Exports Nepal').filter({ visible: true }).first(),
  ).toBeVisible();

  await page.goto('/admin/buyers');
  await page.getByRole('button', { name: 'Add Buyer' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Buyer name').fill('Lagos Pharmacy Ltd');
  await dialog.getByLabel('Country (optional)').fill('Nigeria');
  await dialog.getByRole('button', { name: 'Add buyer' }).click();
  await expect(
    page.getByRole('row', { name: /Lagos Pharmacy Ltd/ }).filter({ visible: true }),
  ).toBeVisible();
  await context.close();
});
