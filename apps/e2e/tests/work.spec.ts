import { expect, test } from '@playwright/test';
import { expectAccessible, signedIn } from './helpers';

test('My Work: tabs per team, oldest first, the Materials task-type filter', async ({
  browser,
}) => {
  const { context, page } = await signedIn(browser, 'neha');
  await page.goto('/work');
  // Neha is in Materials and Design (D24): both tabs, and everything together
  const tabs = page.getByRole('tablist', { name: 'Work by team' }).getByRole('tab');
  await expect(tabs.nth(0)).toContainText('All my work');
  await expect(page.getByRole('tab', { name: /Materials/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Design/ })).toBeVisible();
  await expectAccessible(page, 'my work');

  await page.getByRole('tab', { name: /Materials/ }).click();
  await expect(page).toHaveURL(/tab=MATERIALS/);
  await page.getByRole('combobox', { name: 'Task type' }).click();
  await page.getByRole('option', { name: 'Raw material', exact: true }).click();
  await expect(page).toHaveURL(/tag=RAW_MATERIAL/);
  const rows = page.getByRole('main').getByText('Order raw material').filter({ visible: true });
  await expect(rows.first()).toBeVisible();
  await expect(
    page.getByRole('main').getByText('Packaging annexure').filter({ visible: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/tag=/);

  // A row opens the order at that step
  await page
    .getByRole('main')
    .getByRole('link', { name: /^ORD-\d{4}/ })
    .filter({ visible: true })
    .first()
    .click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}#task-/);
  await expect(page.getByRole('heading', { name: 'Waiting for you' })).toBeVisible();
  await context.close();
});

test('named people see their approvals under "Named on orders"', async ({ browser }) => {
  const { context, page } = await signedIn(browser, 'vikram');
  await page.goto('/work');
  await expect(page.getByRole('tab', { name: /Named on orders/ })).toBeVisible();
  await expect(
    page
      .getByRole('main')
      .getByText(/PI approval · Head Approver/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await context.close();
});
