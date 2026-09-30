import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * The SFS journey in a real browser with the sample data: sign in as Priya → dashboard →
 * the Aug-2026 SFS task → upload India's Aug-26 TB → map the 2 new accounts → comparatives →
 * currency translation (India INR → USD: profit 205,089.66, FCTR 939,726.38 Dr).
 */
const SAMPLES = path.join(__dirname, '..', 'samples');

async function step(page: Page, label: string) {
  await page
    .getByRole('navigation', { name: 'Task steps' })
    .getByRole('button', { name: label })
    .click();
}

test('SFS journey: upload → map → comparatives → translation (India, Aug-2026)', async ({
  page,
}) => {
  // Sign in.
  await page.goto('/login');
  await page.getByLabel('Email').fill('priya@financeclose.local');
  await page.getByLabel('Password', { exact: true }).fill('Priya-Demo-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Dashboard → the Aug-2026 SFS task.
  const row = page.getByRole('row').filter({ hasText: 'SFS-2026-08-001' });
  await row.getByRole('link', { name: /Continue|View/ }).click();
  await expect(page.getByRole('heading', { name: /SFS-2026-08-001/ })).toBeVisible();

  // Step 1: upload India's Aug-26 TB and confirm the columns.
  const india = page
    .locator('[data-slot="card"]')
    .filter({ hasText: 'Aistra GenAI India Pvt Ltd' })
    .first();
  await india
    .getByLabel('Choose trial balance file')
    .setInputFiles(path.join(SAMPLES, 'Trial_Balance_IN_Aug-26.xlsx'));
  const dialog = page.getByRole('dialog', { name: /Confirm columns — IN trial balance/ });
  await expect(dialog.getByText('Balanced — debits equal credits')).toBeVisible();
  await expect(dialog.getByText(/2 new accounts/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm and validate' }).click();
  await expect(dialog).toBeHidden();
  await expect(india.getByText('Validated', { exact: true })).toBeVisible();

  // Step 2: map the two new accounts (keep the suggestions) and save.
  await step(page, 'Review and map');
  await page.getByRole('tab', { name: /IN\s*India/ }).click();
  await expect(page.getByText('Accounts to map (2)')).toBeVisible();
  await expect(page.getByLabel('1455 FSLI')).toHaveValue('CUR_OTH');
  await expect(page.getByLabel('6120 FSLI')).toHaveValue('EMP');
  await page.getByRole('button', { name: 'Save mappings to chart of accounts' }).click();
  await expect(page.getByText(/Accounts to map/)).toBeHidden();
  await expect(page.getByText('17,760,764.50').first()).toBeVisible(); // profit for the period (INR)

  // Step 3: comparatives against the finalised Jul-2026.
  await step(page, 'Comparatives');
  await page.getByRole('tab', { name: /IN\s*India/ }).click();
  await expect(page.getByText('Comparative: Jul-2026')).toBeVisible();
  await expect(page.getByText('Finalised', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/= 181,356,584.16 Cr = opening retained earnings/)).toBeVisible();
  await expect(page.getByText('0 of 2 flagged variances explained')).toBeVisible();

  // Step 4: currency translation, India INR → USD.
  await step(page, 'Currency translation');
  await page.getByRole('tab', { name: /IN\s*India/ }).click();
  await expect(page.getByRole('tab', { name: 'INR → USD' })).toBeVisible();
  await expect(page.getByText(/Rolled forward from finalised Jul-2026/)).toBeVisible();
  const summary = page.locator('[data-slot="card"]').filter({ hasText: 'Summary in USD' });
  await expect(summary.getByRole('row', { name: /Profit for the period/ })).toContainText(
    '205,089.66',
  );
  // FCTR is a debit balance in equity: shown in brackets on the credit-positive summary.
  await expect(summary.getByRole('row', { name: /translation reserve/ })).toContainText(
    '(939,726.38)',
  );
  const fctrRow = page.getByRole('row', {
    name: /Foreign currency translation reserve \(balancing/,
  });
  await expect(fctrRow).toContainText('939,726.38');
  await expect(page.getByText('Assets = liabilities + equity')).toBeVisible();
});
