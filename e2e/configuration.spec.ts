import { expect, type Page, test } from '@playwright/test';

/**
 * Configuration in a real browser: the master admin adds an entity with the wizard, sees it in
 * the org chart and in level 4, then deactivates it; Priya (view only) sees disabled buttons
 * with the tooltip.
 */
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test('master admin: add an entity with the wizard, see it in the group structure, deactivate it', async ({
  page,
}) => {
  await signIn(page, 'master@test.local', 'MasterPass123');
  await page.goto('/configuration/entities');
  await expect(page.getByText('7 entities')).toBeVisible();
  await page.getByRole('button', { name: 'Add entity' }).click();

  // a. Basics
  await page.getByLabel('Legal name').fill('Aistra Labs Singapore Pte');
  await page.getByLabel('Short name').fill('Singapore');
  await page.getByLabel('Code').fill('ZSG');
  await page.getByLabel('Country').fill('Singapore');
  await page.getByLabel('ERP').selectOption('XERO');
  await page.getByRole('button', { name: 'Next' }).click();
  // b. Currencies
  await page.getByLabel('Functional currency').selectOption('SGD');
  await page.getByLabel('Reporting currency').selectOption('SGD');
  await page.locator('label').filter({ hasText: /^USD$/ }).getByRole('checkbox').check();
  await page.getByLabel(/Materiality/).fill('1500');
  await page.getByRole('button', { name: 'Next' }).click();
  // c. Ownership: 100% held by US, with a live preview
  await page.getByLabel('Parent entity').selectOption('US');
  await page.getByLabel('% held by parent').fill('100');
  await expect(page.getByText(/Joins: L4 US \(USD\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  // d. Historical rates: the required USD row
  await page.getByLabel('Rate', { exact: true }).fill('0.74');
  await page.getByRole('button', { name: 'Next' }).click();
  // Review and create
  await expect(page.getByText('100% held by US')).toBeVisible();
  await page.getByRole('button', { name: 'Create entity' }).click();
  await expect(page.getByRole('heading', { name: /Aistra Labs Singapore Pte/ })).toBeVisible();

  // Group structure: the box in the org chart and a member of level 4.
  await page.getByRole('link', { name: 'Group structure' }).click();
  await expect(page.getByRole('button', { name: /Aistra Labs Singapore Pte/ })).toBeVisible();
  const l4 = page.getByRole('row', { name: /L4 US/ });
  await expect(l4).toContainText('Aistra Labs Singapore Pte');
  await expect(l4).toContainText('India group 41.51%');

  // Deactivate it from its page.
  await page.getByRole('button', { name: /Aistra Labs Singapore Pte/ }).click();
  await page.getByRole('button', { name: 'Deactivate' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason (required)').fill('Test entity no longer needed');
  await dialog.getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText('Inactive', { exact: true }).first()).toBeVisible();
});

test('view-only user: the banner, and disabled buttons with the tooltip', async ({ page }) => {
  await signIn(page, 'priya@financeclose.local', 'Priya-Demo-2026');
  await page.goto('/configuration/entities');
  await expect(
    page.getByText('View only – you can see configuration but not change it.'),
  ).toBeVisible();
  const add = page.getByRole('button', { name: 'Add entity' });
  await expect(add).toBeVisible();
  await expect(add).toBeDisabled();
  await expect(
    page.locator('span[title="Needs configuration access – ask your administrator"]').first(),
  ).toBeVisible();
  await page.goto('/configuration/currencies');
  await expect(page.getByRole('button', { name: 'Add currency' })).toBeDisabled();
});
