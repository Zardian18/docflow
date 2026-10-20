import { expect, test } from '@playwright/test';
import { expectAccessible, openOrder, signedIn } from './helpers';

// ORD-0005 in the demo: every component delivered except one
test('the last Deliver Date opens Production QA; the change is in the row history', async ({
  browser,
}) => {
  const { context, page } = await signedIn(browser, 'kabir');
  await openOrder(page, 'ORD-0005');
  await page.getByRole('tab', { name: 'Materials' }).click();
  const waiting = page.getByRole('row').filter({ hasText: 'Waiting' }).first();
  await expect(waiting).toBeVisible();
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
  await expect(page.getByRole('row').filter({ hasText: 'Waiting' })).toHaveCount(0);

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
