import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/**
 * The SFS journey in a real browser with the demo data: sign in as Priya → the Aug-2026 SFS
 * task → upload India's Aug-26 TB → map the 2 new accounts → comparatives → translation →
 * statements (formats, currencies, units, Excel SUM formulas) → notes rolled forward from
 * Jul-2026 (stale figure replaced by a live one, a sub-caption, a custom table note, review,
 * Word export). Expected figures wait for the verified sample files; ties are checked.
 */
const SAMPLES = path.join(__dirname, '..', 'samples');

async function step(page: Page, label: string) {
  await page
    .getByRole('navigation', { name: 'Task steps' })
    .getByRole('button', { name: label })
    .click();
}

test('SFS journey: upload → map → comparatives → translation → statements → notes (India, Aug-2026)', async ({
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
  await step(page, 'Map');
  await page.getByRole('tab', { name: /IN\s*India/ }).click();
  await expect(page.getByText('Accounts to map (2)')).toBeVisible();
  await expect(page.getByLabel('1455 FSLI')).toHaveValue('CUR_OTH');
  await expect(page.getByLabel('6120 FSLI')).toHaveValue('EMP');
  await page.getByRole('button', { name: 'Save mappings to chart of accounts' }).click();
  await expect(page.getByText(/Accounts to map/)).toBeHidden();

  // Expected figures from the page prompts are not checked: the demo data is not verified
  // (waiting for the verified sample files). The flow and every tie are checked.

  // Step 3: comparatives against the finalised Jul-2026.
  await step(page, 'Comparatives');
  await page.getByRole('tab', { name: /IN\s*India/ }).click();
  await expect(page.getByText('Comparative: Jul-2026')).toBeVisible();
  await expect(page.getByText('Finalised', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/= opening retained earnings/)).toBeVisible();

  // Step 4: currency translation, India INR → USD.
  await step(page, 'Translation');
  await page.getByRole('tab', { name: /IN\s*India/ }).click();
  await expect(page.getByRole('tab', { name: 'INR → USD' })).toBeVisible();
  await expect(page.getByText(/Rolled forward from finalised Jul-2026/)).toBeVisible();
  await expect(page.getByText('Assets = liabilities + equity')).toBeVisible();

  // Step 5: statements. Monthly internal format, INR and USD; the ticks agree.
  await step(page, 'Statements');
  await page.getByRole('tab', { name: /IN\s*India/ }).click();
  await page.getByLabel('Format').selectOption({ label: 'Monthly internal (management)' });
  await expect(page.getByText('Preview – not the task format')).toBeVisible();
  const line = (key: string) => page.locator(`tr[data-row="${key}"]`);
  await expect(line('total_eq_liab').getByLabel('Agrees to total assets')).toBeVisible();
  await page.getByLabel('Currency').selectOption('USD');
  await expect(page.getByText(/USD · Actual · Translated from INR/).first()).toBeVisible();
  await expect(line('total_eq_liab').getByLabel('Agrees to total assets')).toBeVisible();
  await page
    .getByLabel('Format')
    .selectOption({ label: 'Statutory FS (Schedule III, Division II) (task format)' });
  await page.getByLabel('Currency').selectOption('INR');
  await page.getByLabel('Units').selectOption('LAKHS');
  await expect(page.getByText('Figures may not add due to rounding')).toBeVisible();
  await page.getByLabel('Units').selectOption('ACTUAL');

  // Excel: a subtotal is a SUM formula over the lines above.
  const xlsx = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await (await xlsx).path());
  let formula = '';
  wb.getWorksheet('P&L')!.eachRow((r) => {
    if (r.getCell(1).value === 'Total expenses (IV)')
      formula = (r.getCell(3).value as { formula: string }).formula;
  });
  expect(formula).toMatch(/^SUM\(C\d+(,-?C\d+)+\)$/);

  // Step 6: notes, carried forward from the finalised Jul-2026.
  await step(page, 'Notes');
  await page.getByRole('tab', { name: /IN\s*India/ }).click();
  await expect(page.getByText(/carried forward from Jul-2026 \(SFS-2026-07-001\)/)).toBeVisible();
  const notes = page.getByRole('navigation', { name: 'Notes' });
  const open = (title: RegExp) => notes.getByRole('button', { name: title }).first().click();

  // A stale number: replace it with a live figure.
  await open(/^\d+\.\s*Other current assets/);
  const stale = page
    .getByRole('alert')
    .filter({ hasText: "This looks like last period's figure (1,200,000)" });
  await expect(stale).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'Last finalised (Jul-2026)' }),
  ).toBeVisible();
  await stale.getByRole('button', { name: 'Replace with a live figure' }).click();
  const picker = page.getByRole('dialog', { name: /Replace "1,200,000" with a live figure/ });
  await picker.getByLabel('Search lines, FSLIs, accounts').fill('1300');
  await picker.getByRole('option', { name: /1300 Prepaid Expenses/ }).click();
  await picker.getByRole('button', { name: 'Insert figure' }).click();
  await expect(page.getByTestId('figure-chip').first()).toBeVisible();
  await expect(page.getByText(/Saved · version 2/)).toBeVisible();
  await expect(stale).toBeHidden();

  // A sub-caption in trade receivables; the note still totals to the face.
  await open(/^\d+\.\s*Trade receivables/);
  await page.getByLabel('New sub-caption').fill('Unsecured, considered good');
  await page.getByRole('button', { name: 'Add sub-caption' }).click();
  await page
    .getByLabel(/^Sub-caption for /)
    .first()
    .selectOption({ label: 'Unsecured, considered good' });
  await expect(page.getByText(/Saved · version/)).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Unsecured, considered good', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Total unsecured, considered good' })).toBeVisible();
  await expect(page.getByLabel('Total agrees to the statement: agrees').first()).toBeVisible();
  await expect(page.getByLabel('Total agrees to the statement: does not agree')).toHaveCount(0);

  // A custom note with a table.
  await page.getByRole('button', { name: 'Add note' }).click();
  const add = page.getByRole('dialog', { name: 'Add note' });
  await add.getByLabel('Title').fill('Contingent liabilities');
  await add.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByLabel('Note title')).toHaveValue('Contingent liabilities');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByLabel('Nature of row').first().fill('Claims not acknowledged as debt');
  await page.getByLabel('Aug-2026 of row').first().fill('500,000');
  await expect(page.getByText(/Saved · version/)).toBeVisible();

  // Review it: the count goes up.
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByText(/^1 of \d+ notes reviewed$/)).toBeVisible();

  // Export to Word: the note and its table are in the document.
  const docx = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Word' }).click();
  const zip = await JSZip.loadAsync(fs.readFileSync(await (await docx).path()));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('Contingent liabilities');
  expect(xml).toContain('Claims not acknowledged as debt');
  expect(xml).toContain('Unsecured, considered good');
});
