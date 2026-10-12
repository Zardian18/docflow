import { expect, test } from '@playwright/test';
import { expectAccessible, pdf, signedIn, watchConsole } from './helpers';

// D23: Meera, Priya and Kabir are both Creators and Approvers in the demo data

test('someone with both roles gets both sets of tabs, Creator first', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'meera');
  await page.goto('/');
  await page.waitForURL('**/submit');
  const tabs = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
  await expect(tabs).toHaveText([
    'New Submission',
    'Pending Approvals',
    'My Submissions',
    'Approval History',
  ]);
  // Both sides work: what waits for her, and what she submitted
  await tabs.filter({ hasText: 'Pending Approvals' }).click();
  await expect(page.getByText('IT_Support_Contract.pdf').filter({ visible: true })).toBeVisible();
  await tabs.filter({ hasText: 'My Submissions' }).click();
  await expect(page.getByText('Warehouse_Rent_Oct.pdf').filter({ visible: true })).toBeVisible();
  await context.close();
});

test('a dual-role creator is left out of their own chain, and told why', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'priya');
  const consoleWatch = watchConsole(page);
  await page.goto('/submit');
  await page.locator('input[type=file]').setInputFiles({
    name: 'E2E_Own_Chain.pdf',
    mimeType: 'application/pdf',
    buffer: pdf('E2E_Own_Chain.pdf'),
  });
  await expect(page.getByText('Uploaded')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('combobox').first().click();
  await page.getByPlaceholder('Company name or code').fill('Micr');
  await page.getByRole('option', { name: /Microtech/ }).click();

  // Microtech's default chain is Priya + Arjun, then Meera: Priya drops out
  const chain = page.getByRole('region', { name: /Approval Chain/ });
  await expect(chain).toContainText('you’ve been left out of this document’s chain');
  await expect(chain).toContainText('Arjun Nair');
  await expect(chain).toContainText('Meera Kulkarni');
  await expect(chain.getByText('Priya Shah')).toHaveCount(0);
  await expectAccessible(page, 'new submission without the creator');

  await page.getByRole('button', { name: 'Submit for Approval' }).click();
  await page.waitForURL(/\/submissions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole('main')).toContainText('Pending Approver (Position 1)');
  consoleWatch.assertClean();
  await context.close();
});

test('My Submissions filters, sorts and keeps the filters in the address', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'rahul');
  await page.goto('/submissions');
  const main = page.getByRole('main');
  await expect(main).toContainText('Q3_Vendor_Invoice.pdf');

  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Rejected' }).click();
  await expect(page).toHaveURL(/status=REJECTED/);
  await expect(main).toContainText('Consulting_Invoice_Aug.pdf');
  await expect(main).not.toContainText('Q3_Vendor_Invoice.pdf');
  await expectAccessible(page, 'my submissions filtered');
  // A refresh keeps the view
  await page.reload();
  await expect(main).not.toContainText('Q3_Vendor_Invoice.pdf');
  await page.getByRole('button', { name: 'Clear filters' }).click();

  await page.getByRole('combobox', { name: 'Sort by' }).click();
  await page.getByRole('option', { name: 'Sort: Document (A–Z)' }).click();
  await expect(page).toHaveURL(/sort=document/);
  const names = main.locator('a[href^="/submissions/"]').filter({ visible: true });
  await expect(names.first()).toHaveText('Consulting_Invoice_Aug.pdf');
  await context.close();
});

test('Approval History filters by my decision and company', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'dev');
  await page.goto('/approvals/history');
  const main = page.getByRole('main');
  await expect(main).toContainText('Annual_Audit_Fees.pdf');
  await page.getByRole('combobox', { name: 'Your decision' }).click();
  await page.getByRole('option', { name: 'I rejected' }).click();
  await expect(main).toContainText('Marketing_Retainer.pdf');
  await expect(main).not.toContainText('Annual_Audit_Fees.pdf');
  await expect(main).toContainText('1 decision');
  await page.getByRole('combobox', { name: 'Company' }).click();
  await page.getByRole('option', { name: 'Nimbus Traders' }).click();
  await expect(main).toContainText('No decisions match these filters');
  await expectAccessible(page, 'approval history filtered');
  await context.close();
});

test('Employee Master gives someone two roles, and keeps Admin on its own', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'admin');
  await page.goto('/admin/masters/employees');
  await page.getByRole('button', { name: 'Add Employee' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('Esha Dual');
  await dialog.getByLabel('Email').fill('esha@demo.docflow.test');
  const roles = dialog.getByRole('group', { name: 'Roles' });
  await roles.getByLabel('Creator', { exact: true }).check();
  // Admin and CFO can't join, and say why
  await expect(roles.getByLabel(/^Admin/)).toBeDisabled();
  await expect(roles).toContainText("Admin can't be combined with any other role");
  await roles.getByLabel('Approver', { exact: true }).check();
  await expectAccessible(page, 'employee dialog with two roles');
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  // Saving shows the one-time password link
  await expect(page.getByRole('dialog', { name: /Password link for Esha Dual/ })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  const row = page.getByRole('row', { name: /Esha Dual/ }).filter({ visible: true });
  await expect(row).toContainText('Creator');
  await expect(row).toContainText('Approver');
  await context.close();
});

test('Role Master: a role can exclude roles of the other kind, both ways', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'admin');
  await page.goto('/admin/masters/roles');
  await page.getByRole('button', { name: 'Add Role' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Role name').fill('Auditor');
  // Default permission is Approver, so Creator roles can be excluded
  const excluded = dialog.getByRole('group', { name: 'Can’t be combined with' });
  await excluded.getByLabel('Creator', { exact: true }).check();
  await expectAccessible(page, 'role dialog with exclusions');
  // Priya, Meera and Kabir hold Creator but not Auditor, so this saves
  await dialog.getByRole('button', { name: 'Add role' }).click();
  await expect(dialog).toBeHidden();
  const auditor = page.getByRole('row', { name: /^Auditor/ }).filter({ visible: true });
  await expect(auditor).toContainText('Creator');
  const creator = page.getByRole('row', { name: /^Creator/ }).filter({ visible: true });
  await expect(creator).toContainText('Auditor');
  await context.close();
});
