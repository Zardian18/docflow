import { expect, test } from '@playwright/test';
import { expectAccessible, openOrder, ORDERS, signedIn } from './helpers';

// In the demo, one component of this order is dispatched but not yet delivered (D27)
test('the last Deliver Date opens Production QA; the change is in the row history', async ({
  browser,
}) => {
  const { context, page } = await signedIn(browser, 'kabir');
  await openOrder(page, ORDERS.delivery);
  await page.getByRole('tab', { name: 'Materials' }).click();
  const waiting = page
    .getByRole('row')
    .filter({ hasText: 'Dispatched' })
    .filter({ visible: true })
    .first();
  await expect(waiting).toBeVisible();
  // The day counts: ordering took some days, delivery is still counting
  await expect(waiting).toContainText(/took \d+ days?/);
  await expect(waiting).toContainText(/counting/);
  await expect(waiting).toContainText('Still needed: Deliver Date');
  await expectAccessible(page, 'component tables');
  await waiting.getByRole('button', { name: /^Edit / }).click();
  const dialog = page.getByRole('dialog');
  const today = new Date().toISOString().slice(0, 10);
  await dialog.getByLabel('Deliver Date').fill(today);
  await dialog.getByLabel('TNS Remark (manufacturer)').fill('Delivered in full');
  await dialog.getByLabel(/Why/).fill('Truck arrived this morning');
  await expectAccessible(page, 'component dialog');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('row').filter({ hasText: 'Dispatched' }).filter({ visible: true }),
  ).toHaveCount(0);
  // The reason shows in the table's Notes column for everyone (D28)
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'Truck arrived this morning' })
      .filter({ visible: true }),
  ).toHaveCount(1);

  // Only a Why, nothing else changed: it still shows in Notes (this used to be dropped)
  const raw = page
    .getByRole('row')
    .filter({ hasText: 'Dextrose anhydrous' })
    .filter({ visible: true })
    .first();
  await raw.getByRole('button', { name: /^Edit / }).click();
  await page.getByRole('dialog').getByLabel(/Why/).fill('Supplier confirmed by phone');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(raw).toContainText('Supplier confirmed by phone');
  await expect(raw).toContainText('Kabir Singh');

  // History shows who changed what, and why
  await page
    .getByRole('button', { name: /^History of / })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Chain' }).click();
  await expect(page.getByText(/With Production/).first()).toBeVisible();
  await context.close();

  // Production now has it waiting
  const farhan = await signedIn(browser, 'farhan');
  await farhan.page.goto('/work');
  await expect(
    farhan.page.getByRole('main').getByText('Production QA').filter({ visible: true }).first(),
  ).toBeVisible();
  await farhan.context.close();
});
