/**
 * Writes the sample files into ./samples (npm run samples:generate):
 *   Trial_Balance_<code>_Jul-26.xlsx and _Aug-26.xlsx for all 7 entities (Zoho layout),
 *   Chart_of_Accounts_IN_sample.xlsx and Exchange_Rates_per_USD_sample.xlsx.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../src/config/paths';
import { SAMPLE_ENTITIES } from './sample-data';
import {
  chartOfAccountsInFile,
  exchangeRatesFile,
  tbFileName,
  trialBalanceFile,
} from './sample-files';

const OUT = path.join(REPO_ROOT, 'samples');
mkdirSync(OUT, { recursive: true });

const write = (file: string, body: Buffer) => {
  writeFileSync(path.join(OUT, file), body);
  console.log(`samples/${file}`);
};

for (const e of SAMPLE_ENTITIES) {
  for (const month of ['jul', 'aug'] as const)
    write(tbFileName(e.code, month), trialBalanceFile(e, month));
}
write('Chart_of_Accounts_IN_sample.xlsx', chartOfAccountsInFile());
write('Exchange_Rates_per_USD_sample.xlsx', exchangeRatesFile());
