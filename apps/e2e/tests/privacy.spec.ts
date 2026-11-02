import { expect, test, type Page } from '@playwright/test';
import {
  expectAccessible,
  expectNoSidewaysScroll,
  openOrder,
  ORDERS,
  pdf,
  signedIn,
} from './helpers';

const secret = 'Private: batch format still wrong';

/** The action card for a step on the order page */
const card = (page: Page, title: RegExp) =>
  page
    .getByRole('region', { name: title })
    .filter({ has: page.getByRole('button') })
    .first();

test('a private send-back reaches only the people it is shared with (D29)', async ({ browser }) => {
  // Regulation sends an annexure back privately, sharing it with Rohan (Marketing)
  const lina = await signedIn(browser, 'lina');
  await openOrder(lina.page, ORDERS.loops);
  const c = card(lina.page, /^Packaging annexure/);
  await c.getByLabel('Make this private').check();
  await c.getByRole('combobox', { name: /Share with a person/ }).click();
  // Approvers and Head Approvers aren't offered: they're always included (D31)
  await lina.page.getByPlaceholder('Search by name').fill('Priya');
  await expect(lina.page.getByRole('option', { name: /Priya Shah/ })).toHaveCount(0);
  await lina.page.getByPlaceholder('Search by name').fill('Rohan');
  await lina.page.getByRole('option', { name: /Rohan Kapoor/ }).click();
  await expect(c.getByRole('list', { name: 'Shared with' })).toContainText('Rohan Kapoor');
  await expectAccessible(lina.page, 'private picker');
  await c.getByLabel(/Comments/).fill(secret);
  await c.getByRole('button', { name: 'Send back with comments' }).click();
  await expect(lina.page.getByText(secret).first()).toBeVisible();
  await expect(lina.page.getByText(/Private · shared with Rohan Kapoor/).first()).toBeVisible();
  await lina.context.close();

  // Rohan: a notice on My Work, and the message inside the otherwise hidden Phase 2
  const rohan = await signedIn(browser, 'rohan');
  // Unread shared messages make the tab stand out
  await rohan.page.goto('/work');
  await expect(rohan.page.getByRole('tab', { name: /Shared with you/ })).toHaveClass(
    /bg-primary-soft/,
  );
  await rohan.page.goto('/work?tab=shared');
  const notice = rohan.page
    .getByRole('list', { name: 'Shared with you' })
    .getByRole('listitem')
    .first();
  await expect(notice).toContainText('Lina Fernandes shared a private message with you');
  await expect(notice).toContainText(secret);
  await expectAccessible(rohan.page, 'shared with you');
  await openOrder(rohan.page, ORDERS.loops);
  await expect(rohan.page.getByText('In the hands of the teams working on it.')).toBeVisible();
  await expect(rohan.page.getByText(secret)).toBeVisible();
  await expect(rohan.page.getByRole('tab', { name: 'Materials' })).toHaveCount(0);
  await rohan.page.goto('/work?tab=shared');
  await rohan.page.getByRole('button', { name: 'Mark as read' }).first().click();
  await expect(rohan.page.getByText(secret)).toHaveCount(0);
  await rohan.context.close();

  // Design isn't part of the annexure loop and wasn't tagged: nothing at all
  const ananya = await signedIn(browser, 'ananya');
  await openOrder(ananya.page, ORDERS.loops);
  await expect(ananya.page.getByText('Packaging annexure').first()).toBeVisible();
  await expect(ananya.page.getByText(secret)).toHaveCount(0);
  await ananya.context.close();
});

test('raw material is marked ordered only once every component has its PO, attached in one place (D31)', async ({
  browser,
}) => {
  const { context, page } = await signedIn(browser, 'kabir');
  await openOrder(page, ORDERS.loops);
  const c = card(page, /^Order raw material · Amoxicillin/);
  // The step has no upload of its own: it points to Purchase orders at the start of the chain
  await expect(c.locator('input[type=file]')).toHaveCount(0);
  await expect(c.getByRole('link', { name: 'Purchase orders' })).toBeVisible();
  await c.getByRole('button', { name: 'Raw material ordered' }).click();
  await expect(c.getByRole('alert')).toContainText('Upload the Purchase order (PO) for');
  const row = page
    .getByRole('region', { name: /Purchase orders for each component/ })
    .getByRole('listitem')
    .filter({ hasText: 'Amoxicillin trihydrate' });
  await expect(row.getByText('PO needed')).toBeVisible();
  await row
    .locator('input[type=file]')
    .setInputFiles({ name: 'PO_amox.pdf', mimeType: 'application/pdf', buffer: pdf('PO') });
  await expect(row.getByText('PO uploaded')).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole('button', { name: 'View Purchase order (PO)' })).toBeVisible();
  await expectAccessible(page, 'PO uploads');
  await c.getByRole('button', { name: 'Raw material ordered' }).click();
  await expect(page.getByRole('region', { name: /^Order raw material · Amoxicillin/ })).toHaveCount(
    0,
  );
  await context.close();
});

test('the new pieces fit a phone screen (375px)', async ({ browser }) => {
  for (const [who, path] of [
    ['rohan', null],
    ['rohan', '/work?tab=shared'],
    ['kabir', null],
    ['lina', null],
  ] as const) {
    const { context, page } = await signedIn(browser, who);
    await page.setViewportSize({ width: 375, height: 800 });
    if (path) await page.goto(path);
    else await openOrder(page, ORDERS.loops);
    await page.waitForLoadState('networkidle');
    if (who === 'lina') await page.getByLabel('Make this private').first().check();
    await expectNoSidewaysScroll(page, `${who} ${path ?? 'order'}`);
    await context.close();
  }
});

test('Purchase orders in the Chain tab: Materials attaches, Approvers and Admin view (D31)', async ({
  browser,
}) => {
  const area = (page: Page) =>
    page.getByRole('region', { name: /Purchase orders for each component/ });
  // Materials: every component of every product, each with its PO and an upload area
  const kabir = await signedIn(browser, 'kabir');
  await openOrder(kabir.page, ORDERS.delivery);
  await expect(area(kabir.page)).toBeVisible();
  await expect(area(kabir.page).getByText('PO uploaded').first()).toBeVisible();
  await expect(
    area(kabir.page)
      .getByText(/Drop the PO for|Replace the PO for/)
      .first(),
  ).toBeVisible();
  await expectAccessible(kabir.page, 'purchase orders');
  await kabir.context.close();
  // An approver: sees and opens them (and the Materials tab), can't upload
  const priya = await signedIn(browser, 'priya');
  await openOrder(priya.page, ORDERS.delivery);
  await expect(
    area(priya.page).getByRole('button', { name: 'View Purchase order (PO)' }).first(),
  ).toBeVisible();
  await expect(area(priya.page).getByText(/Drop the PO for/)).toHaveCount(0);
  await expect(priya.page.getByRole('tab', { name: 'Materials' })).toBeVisible();
  await priya.context.close();
  // Admin sees everything, POs and the Materials tab included (D31)
  const admin = await signedIn(browser, 'admin');
  await openOrder(admin.page, ORDERS.delivery);
  await expect(
    area(admin.page).getByRole('button', { name: 'View Purchase order (PO)' }).first(),
  ).toBeVisible();
  await expect(area(admin.page).getByText(/Drop the PO for/)).toHaveCount(0);
  await expect(admin.page.getByRole('tab', { name: 'Materials' })).toBeVisible();
  await admin.context.close();
  // Marketing alone: no purchase orders at all
  const rohan = await signedIn(browser, 'rohan');
  await openOrder(rohan.page, ORDERS.qa);
  await expect(rohan.page.getByText('Phase 1 · Sales and PI')).toBeVisible();
  await expect(area(rohan.page)).toHaveCount(0);
  await rohan.context.close();
});
