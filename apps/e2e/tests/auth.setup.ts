import { expect, test as setup } from '@playwright/test';
import { authFile, DEMO_PASSWORD, emailOf, PEOPLE, type Person } from './helpers';

// Sign every persona in once through the real login form; tests reuse the session cookie
for (const who of Object.keys(PEOPLE) as Person[]) {
  setup(`sign in as ${who}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(emailOf(who));
    await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(PEOPLE[who]).first()).toBeVisible();
    await page.context().storageState({ path: authFile(who) });
  });
}
