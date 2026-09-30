import { checkFormatCoverage } from '@finance-close/engine';
import { FORMAT_DEFINITIONS } from '../../prisma/format-definitions';
import { FSLIS } from '../../prisma/seed-accounts';

const fslis = FSLIS.map(([code, name, statement, cls]) => ({ code, name, statement, class: cls }));

describe('seeded report formats', () => {
  it.each(FORMAT_DEFINITIONS.map((f) => [f.name, f] as const))(
    '%s places every FSLI exactly once and marks its totals',
    (_name, f) => {
      expect(checkFormatCoverage(f.lines, fslis)).toEqual([]);
    },
  );
});
