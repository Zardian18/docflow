import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, pdf, signedIn, watchConsole, type Person } from './helpers';

async function as(browser: import('@playwright/test').Browser, who: Person, url: string) {
  const s = await signedIn(browser, who);
  await s.page.goto(url);
  return s;
}

/** The action card for a step on the order page */
const card = (page: Page, title: string | RegExp) =>
  page
    .getByRole('region', { name: title })
    .filter({ has: page.getByRole('button') })
    .first();

async function upload(page: Page, scope: ReturnType<Page['locator']>, name: string) {
  await scope
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name, mimeType: 'application/pdf', buffer: pdf(name) });
  await expect(scope.getByText('Uploaded').first()).toBeVisible({ timeout: 30_000 });
}

test('Phase 1 in the browser: order, CBM loop, PI with both versions, approvals, advance', async ({
  browser,
}) => {
  // Marketing creates the order; the buyer's default chain is filled in (D27)
  const rohan = await as(browser, 'rohan', '/orders/new');
  const consoleWatch = watchConsole(rohan.page);
  await rohan.page.getByRole('combobox', { name: /^Buyer:/ }).click();
  await rohan.page.getByPlaceholder('Search buyers').fill('Andes');
  await rohan.page.getByRole('option', { name: /Andes Pharma/ }).click();
  await expect(rohan.page.getByRole('combobox', { name: 'Creator: Sara Khan' })).toBeVisible();
  await expectAccessible(rohan.page, 'new order');
  await rohan.page.getByRole('button', { name: 'Create order' }).click();
  await rohan.page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
  const orderUrl = rohan.page.url();
  await expect(rohan.page.getByText('With Creator: Sara Khan')).toBeVisible();
  consoleWatch.assertClean();

  // The Creator sends the CBM; Marketing returns it once, then confirms
  const sara = await as(browser, 'sara', orderUrl);
  let c = card(sara.page, /^CBM/);
  await upload(sara.page, c, 'CBM_v1.pdf');
  await expectAccessible(sara.page, 'CBM action');
  await c.getByRole('button', { name: 'Send CBM to Marketing' }).click();
  await expect(sara.page.getByText('With Marketing: Rohan Kapoor')).toBeVisible();

  await rohan.page.reload();
  c = card(rohan.page, /^CBM/);
  // The latest CBM is right on the step, and each button acts straight away (D27)
  await expect(c.getByRole('button', { name: 'View CBM' })).toBeVisible();
  await expect(c.getByRole('button', { name: 'Download CBM' })).toBeVisible();
  await expect(c.getByRole('button', { name: 'Confirm CBM' })).toHaveCount(1);
  await c.getByRole('button', { name: 'Send back with comments' }).click();
  await expect(c.getByRole('alert')).toContainText('Say what needs changing');
  await c.getByLabel(/Comments/).fill('Use 40ft containers');
  await c.getByRole('button', { name: 'Send back with comments' }).click();
  await expect(rohan.page.getByText(/Returned by .*Rohan Kapoor/)).toBeVisible();

  await sara.page.reload();
  c = card(sara.page, /^CBM/);
  await upload(sara.page, c, 'CBM_v2.pdf');
  await c.getByRole('button', { name: 'Send CBM to Marketing' }).click();
  await rohan.page.reload();
  await card(rohan.page, /^CBM/).getByRole('button', { name: 'Confirm CBM' }).click();
  await card(rohan.page, /Buyer confirmed the CBM/)
    .getByRole('button', { name: 'Buyer confirmed CBM' })
    .click();
  await expect(rohan.page.getByText(/0 days · since/).first()).toBeVisible();

  // The PI: both versions and the products
  await sara.page.reload();
  c = card(sara.page, /^Proforma Invoice/);
  await c.getByRole('button', { name: 'Submit PI for approval' }).click();
  await expect(c.getByRole('alert')).toContainText('Attach the PI (full)');
  const zones = c.locator('input[type=file]');
  await zones
    .nth(0)
    .setInputFiles({ name: 'PI.pdf', mimeType: 'application/pdf', buffer: pdf('PI') });
  await zones.nth(1).setInputFiles({
    name: 'PI_no_rates.pdf',
    mimeType: 'application/pdf',
    buffer: pdf('PI no rates'),
  });
  await expect(c.getByText('Uploaded')).toHaveCount(2, { timeout: 30_000 });
  await c
    .getByLabel('Products on this order, one per line')
    .fill('Paracetamol 500mg Tablets\nORS Sachets');
  // The Creator is asked to change the order number to the PI's
  await expect(c.getByText(/match the PI number/)).toBeVisible();
  await c.getByLabel('Order number').fill('TPE/PI/26-27/0100');
  await c.getByRole('button', { name: 'Submit PI for approval' }).click();
  await expect(sara.page.getByText('With Marketing: Rohan Kapoor')).toBeVisible();
  await expect(sara.page.getByRole('heading', { name: /TPE\/PI\/26-27\/0100/ })).toBeVisible();

  // Marketing → Approver → Head Approver
  for (const who of ['rohan', 'priya', 'vikram'] as const) {
    const s = who === 'rohan' ? rohan : await as(browser, who, orderUrl);
    await s.page.reload();
    await card(s.page, /^PI approval/)
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    await expect(s.page.getByText(/approved by/).first()).toBeVisible();
  }
  await rohan.page.reload();
  await card(rohan.page, /PI sent, advance requested/)
    .getByRole('button', { name: 'Advance requested' })
    .click();

  // Accounts verifies the advance: production starts
  const pooja = await as(browser, 'pooja', orderUrl);
  c = card(pooja.page, /Advance payment verified/);
  await c.getByLabel('Amount').fill('30000');
  await expectAccessible(pooja.page, 'payment form');
  await c.getByRole('button', { name: 'Verify advance' }).click();
  await expect(pooja.page.getByText(/Since production started/)).toBeVisible();
  await expect(pooja.page.getByText('Order raw material').first()).toBeVisible();

  // Regulation sees the version without rates only (enforced by the server)
  const lina = await as(browser, 'lina', `${orderUrl}?tab=details`);
  await expect(lina.page.getByText('PI (without rates)')).toBeVisible();
  await expect(lina.page.getByText('PI (full)')).toHaveCount(0);
  for (const s of [rohan, sara, pooja, lina]) await s.context.close();
});
