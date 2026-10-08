import { expect, test } from '@playwright/test';
import { expectAccessible, signedIn, watchConsole, type Person } from './helpers';

/**
 * WCAG 2.1 A/AA scan (axe) of every screen, as the person who uses it, at desktop and
 * phone widths. Pages that need a document open the first one in the person's list.
 */
const SCREENS: Array<{ who: Person | null; path: string; wait: string | RegExp }> = [
  { who: null, path: '/login', wait: 'Sign in' },
  { who: null, path: '/forgot-password', wait: /password/i },
  { who: null, path: '/set-password?token=not-a-real-token', wait: /password/i },
  { who: null, path: '/no-such-page', wait: 'Page not found' },
  { who: 'admin', path: '/admin', wait: 'Total Workflows' },
  { who: 'admin', path: '/admin/masters/companies', wait: 'Microtech Pvt Ltd' },
  { who: 'admin', path: '/admin/masters/companies/new', wait: /Company/ },
  { who: 'admin', path: '/admin/masters/employees', wait: 'Rahul Mehra' },
  { who: 'admin', path: '/admin/masters/roles', wait: 'Approver' },
  { who: 'admin', path: '/account/password', wait: /password/i },
  { who: 'rahul', path: '/submit', wait: /Upload|Drop/i },
  { who: 'rahul', path: '/submissions', wait: 'Q3_Vendor_Invoice.pdf' },
  { who: 'priya', path: '/approvals', wait: 'Q3_Vendor_Invoice.pdf' },
  { who: 'priya', path: '/approvals/history', wait: /History/ },
  { who: 'cfo', path: '/final-approvals', wait: 'Server_Hardware_PO.pdf' },
  { who: 'cfo', path: '/final-approvals?view=rejected', wait: 'Marketing_Retainer.pdf' },
  { who: 'cfo', path: '/final-approvals/history', wait: /History/ },
];

// Detail pages, reached by clicking through like a user would
const DETAILS: Array<{ who: Person; list: string; open: RegExp | string; url: RegExp }> = [
  {
    who: 'rahul',
    list: '/submissions',
    open: 'Q3_Vendor_Invoice.pdf',
    url: /\/submissions\/[0-9a-f-]{36}$/,
  },
  { who: 'priya', list: '/approvals', open: /^Review /, url: /\/approvals\/[0-9a-f-]{36}$/ },
  {
    who: 'cfo',
    list: '/final-approvals',
    open: /^Review /,
    url: /\/final-approvals\/[0-9a-f-]{36}$/,
  },
  {
    who: 'admin',
    list: '/admin',
    open: 'Q3_Vendor_Invoice.pdf',
    url: /\/admin\/workflows\/[0-9a-f-]{36}$/,
  },
  {
    who: 'admin',
    list: '/admin/masters/companies',
    open: /^Edit Microtech/,
    url: /\/admin\/masters\/companies\/[0-9a-f-]{36}$/,
  },
];

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
        // Phones hide the desktop table and show cards, so match only what is visible
        await expect(page.getByText(s.wait).filter({ visible: true }).first()).toBeVisible();
        await expectAccessible(page, `${s.path} @${width}`);
        consoleWatch.assertClean();
        await context.close();
      });
    }

    for (const d of DETAILS) {
      test(`${d.who} detail from ${d.list}`, async ({ browser }) => {
        const { context, page } = await signedIn(browser, d.who);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(d.list);
        // "Review" and "Edit …" are links; document names open their row or card on click
        const target =
          d.open instanceof RegExp
            ? page.getByRole('link', { name: d.open })
            : page.getByText(d.open, { exact: true });
        await target.filter({ visible: true }).first().click();
        await expect(page).toHaveURL(d.url);
        await expect(page.getByRole('main')).not.toBeEmpty();
        await page.waitForLoadState('networkidle');
        await expectAccessible(page, `${d.who} detail @${width}`);
        await context.close();
      });
    }
  });
}
