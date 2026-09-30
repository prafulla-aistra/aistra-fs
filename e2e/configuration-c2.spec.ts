import { expect, type Page, test } from '@playwright/test';

/**
 * Configuration C2 in a real browser: the report-format coverage check blocks saving when
 * "Other expenses" is left unplaced; the exchange-rate grid shows locked months and the
 * cross-rate viewer; a view-only user cannot edit.
 */
async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test('report formats: leaving "Other expenses" unplaced blocks saving', async ({ page }) => {
  await signIn(page, 'master@test.local', 'MasterPass123');
  await page.goto('/configuration/formats');
  await page.getByRole('tab', { name: /Statutory FS/ }).click();
  const coverage = page.getByLabel('Coverage check');
  await expect(coverage).toContainText('Coverage check passed');

  // Take Other expenses off its line.
  await page.getByLabel('Line for Other expenses').selectOption('');
  await expect(coverage).toContainText('Coverage check failed');
  await expect(coverage).toContainText('Other expenses (OTH_EXP) is not placed on any P&L line.');
  await expect(page.getByText(/Saving is blocked: 1 coverage problem/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Save (format|as version)/ })).toBeDisabled();

  // Put it back: the check passes again and saving is allowed (not done here).
  await page.getByLabel('Line for Other expenses').selectOption({ label: 'Other expenses' });
  await expect(coverage).toContainText('Coverage check passed');
  await expect(page.getByRole('button', { name: /Save (format|as version)/ })).toBeEnabled();
  await page.getByRole('button', { name: 'Discard changes' }).click();

  // The version note: a finalised report uses v1.
  await expect(page.getByText(/Saving creates version 2/)).toBeVisible();
});

test('exchange rates: locked months, the month drawer and the cross-rate viewer', async ({
  page,
}) => {
  await signIn(page, 'master@test.local', 'MasterPass123');
  await page.goto('/configuration/exchange-rates');
  const jul = page.getByRole('row', { name: /Jul-2026/ });
  await expect(jul).toContainText('Locked');
  await expect(jul).toContainText('SFS-2026-07-001');
  await expect(page.getByText('FY 2026-27')).toBeVisible();
  await page.getByRole('button', { name: 'Open Jul-2026' }).click();
  const drawer = page.getByRole('dialog', { name: 'Jul-2026 rates' });
  await expect(drawer).toContainText('Locked months cannot be edited.');
  await expect(drawer.getByLabel('INR closing')).toBeDisabled();
  await drawer.getByRole('button', { name: 'Close', exact: true }).first().click();

  await page.getByLabel('Cross-rate month').selectOption({ label: 'Aug-2026' });
  await page.getByLabel('From currency').selectOption('GBP');
  await page.getByLabel('To currency').selectOption('INR');
  await expect(page.getByText('1 GBP = 116.3319946452 INR')).toBeVisible();
});

test('view-only user: rates, formats and chart of accounts cannot be edited', async ({ page }) => {
  await signIn(page, 'priya@financeclose.local', 'Priya-Demo-2026');
  await page.goto('/configuration/exchange-rates');
  await expect(page.getByRole('button', { name: 'Add next month' })).toBeDisabled();
  await page.goto('/configuration/chart-of-accounts');
  await expect(page.getByLabel('Chart of accounts stats')).toContainText('Mapped');
  await expect(page.getByRole('button', { name: 'Upload Zoho COA' })).toBeDisabled();
  await page.goto('/configuration/formats');
  await expect(page.getByLabel('Format name')).toBeDisabled();
});
