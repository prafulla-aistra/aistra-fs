import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import ExcelJS from 'exceljs';

/**
 * The SFS journey in a real browser with the sample data: sign in as Priya → dashboard →
 * the Aug-2026 SFS task → upload India's Aug-26 TB → map the 2 new accounts → comparatives →
 * currency translation (India INR → USD: profit 205,089.66, FCTR 939,726.38 Dr) → statements
 * and notes (internal format INR and USD, Statutory, notes, Lakhs, Excel export).
 */
const SAMPLES = path.join(__dirname, '..', 'samples');

async function step(page: Page, label: string) {
  await page
    .getByRole('navigation', { name: 'Task steps' })
    .getByRole('button', { name: label })
    .click();
}

test('SFS journey: upload → map → comparatives → translation → statements (India, Aug-2026)', async ({
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

  // Step 5: statements and notes, India. Monthly internal format in INR.
  await step(page, 'Statements and notes');
  await page.getByRole('tab', { name: /IN\s*India/ }).click();
  await page.getByLabel('Format').selectOption({ label: 'Monthly internal (management)' });
  await expect(page.getByText('Preview – not the task format')).toBeVisible();
  const line = (key: string) => page.locator(`tr[data-row="${key}"]`);
  await expect(page.getByRole('tab', { name: 'Profit and loss' })).toBeVisible();
  await expect(line('total_assets')).toContainText('745,317,348.66');
  await expect(line('total_assets')).toContainText('727,556,584.16');
  await expect(line('total_eq_liab').getByLabel('Agrees to total assets')).toBeVisible();
  await page.getByRole('tab', { name: 'Profit and loss' }).click();
  await expect(line('revenue')).toContainText('59,870,764.50');
  await expect(line('revenue')).toContainText('57,506,584.16');
  await expect(line('ebitda')).toContainText('20,810,764.50');
  await expect(line('net_profit')).toContainText('17,760,764.50');

  // USD.
  await page.getByLabel('Currency').selectOption('USD');
  await expect(page.getByText(/USD · Actual · Translated from INR/).first()).toBeVisible();
  await expect(line('net_profit')).toContainText('205,089.66');
  await expect(line('net_profit')).toContainText('189,971.96');
  await expect(line('revenue')).toContainText('691,348.32');

  // Statutory (the task format), INR.
  await page
    .getByLabel('Format')
    .selectOption({ label: 'Statutory FS (Schedule III, Division II) (task format)' });
  await page.getByLabel('Currency').selectOption('INR');
  await expect(page.getByText('Preview – not the task format')).toBeHidden();
  await expect(line('total_income')).toContainText('60,120,764.50');
  await expect(line('employee')).toContainText('33,310,000.00');
  await expect(line('profit')).toContainText('17,760,764.50');

  // Notes: Note 1 draft, a line note that ties, the intercompany note.
  await page.getByRole('tab', { name: 'Notes to accounts' }).click();
  await expect(page.getByText('Auto-drafted from the entity master')).toBeVisible();
  await expect(page.getByText(/Aistra GenAI India Pvt Ltd \("the Company"\)/)).toBeVisible();
  const empNote = page.getByRole('article', { name: /Employee benefits expense/ });
  await expect(empNote).toContainText('33,310,000.00');
  await expect(empNote.getByLabel('Agrees to the face').first()).toBeVisible();
  await expect(
    page.getByText(
      'Related party balances – intercompany (full related party disclosure to follow)',
    ),
  ).toBeVisible();

  // Lakhs, on the balance sheet.
  await page.getByLabel('Units').selectOption('LAKHS');
  await page.getByRole('tab', { name: 'Balance sheet' }).click();
  await expect(line('total_assets')).toContainText('7,453.17');
  await expect(page.getByText('Figures may not add due to rounding')).toBeVisible();

  // Excel: a subtotal is a SUM formula over the lines above.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  const file = await (await download).path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const pl = wb.getWorksheet('P&L')!;
  let formula = '';
  pl.eachRow((r) => {
    if (r.getCell(1).value === 'Total expenses (IV)')
      formula = (r.getCell(3).value as { formula: string }).formula;
  });
  expect(formula).toMatch(/^SUM\(C\d+(,-?C\d+)+\)$/);
});
