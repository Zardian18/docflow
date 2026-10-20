import { expect, test } from '@playwright/test';
import { expectAccessible, signedIn, watchConsole, type Person } from './helpers';

/** WCAG 2.1 A/AA scan (axe) of every screen, as the person who uses it, at desktop and phone widths. */
const SCREENS: Array<{ who: Person | null; path: string; wait: string | RegExp }> = [
  { who: null, path: '/login', wait: 'Sign in' },
  { who: null, path: '/forgot-password', wait: /password/i },
  { who: null, path: '/set-password?token=not-a-real-token', wait: /password/i },
  { who: null, path: '/no-such-page', wait: 'Page not found' },
  { who: 'kabir', path: '/work', wait: 'All my work' },
  { who: 'dev', path: '/work', wait: 'All my work' },
  { who: 'vikram', path: '/work', wait: 'Named on orders' },
  { who: 'admin', path: '/orders', wait: /ORD-0001/ },
  { who: 'rohan', path: '/orders/new', wait: 'Named people' },
  { who: 'admin', path: '/admin/employees', wait: 'Kabir Singh' },
  { who: 'admin', path: '/admin/companies', wait: 'Trident Pharma Exports' },
  { who: 'admin', path: '/admin/companies/new', wait: 'Named people' },
  { who: 'admin', path: '/admin/buyers', wait: 'Andes Pharma' },
  { who: 'admin', path: '/account/password', wait: /password/i },
];

// ORD-0008 is at sea with loops, votes and checkpoints: every part of the order page shows
const ORDER_TABS = ['Chain', 'Materials', 'History', 'Details'];

for (const width of [1280, 375]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const s of SCREENS) {
      test(`${s.who ?? 'signed out'} ${s.path}`, async ({ browser }) => {
        const { context, page } = s.who
          ? await signedIn(browser, s.who)
          : await browser.newContext().then(async (c) => ({ context: c, page: await c.newPage() }));
        await page.setViewportSize({ width, height: 900 });
        const consoleWatch = watchConsole(page);
        await page.goto(s.path);
        await expect(page.getByText(s.wait).filter({ visible: true }).first()).toBeVisible();
        await expectAccessible(page, `${s.path} @${width}`);
        consoleWatch.assertClean();
        await context.close();
      });
    }

    test('the order page, every tab', async ({ browser }) => {
      const { context, page } = await signedIn(browser, 'admin');
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/orders?q=ORD-0008');
      await page.getByRole('link', { name: 'ORD-0008' }).filter({ visible: true }).first().click();
      await page.waitForURL(/\/orders\/[0-9a-f-]{36}/);
      for (const tab of ORDER_TABS) {
        await page.getByRole('tab', { name: tab }).click();
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('main')).not.toBeEmpty();
        await expectAccessible(page, `order ${tab} @${width}`);
      }
      await context.close();
    });
  });
}
