/**
 * Client groupings (marker: audit_log SEED_APPLIED client-groupings). Runs once; after that
 * Configuration owns the data.
 *
 *  - FSLIs for the client's groupings the statutory FSLIs did not cover (engine CLIENT_FSLIS),
 *    each placed next to its anchor FSLI on every stored format line, so the Statutory and
 *    Investor layouts (and their coverage check) are unchanged in shape.
 *  - The Management format gets a new version in the client's own layout (the "Aistra Group
 *    Entity Wise P&L / BS" sheets of the monthly Financials workbook). Tasks not yet finalised
 *    move to it, as when a format is saved in Configuration.
 */
import type { PrismaClient } from '@prisma/client';
import { checkFormatCoverage, CLIENT_FSLIS } from '@finance-close/engine';
import { build, H, L, T } from './format-definitions';
import { formatLineRows } from './seed-formats';

const MARKER = { action: 'SEED_APPLIED', entityType: 'SEED', entityId: 'client-groupings' };

/** The client's management layout; extra lines only for FSLIs the client has no line for. */
export const CLIENT_MANAGEMENT = build(
  [
    H('revenue_h', 'Revenue'),
    L('rev_onetime', 'Revenue-Onetime', ['REV_ONETIME'], 1),
    L('rev_recur', 'Revenue-Recurring', ['REV_RECUR', 'REV_OPS'], 1),
    L('ic_rev', 'Intercompany Revenue', ['IC_REV'], 1),
    L('rev_acq', 'Revenue from Acquisitions', ['REV_ACQ'], 1),
    T('total_revenue', 'Total Revenue', 'rev_onetime + rev_recur + ic_rev + rev_acq'),
    L('other_income', 'Other Income', ['OTH_INC']),
    T('total_income', 'Total Income', 'total_revenue + other_income'),
    H('cor_h', 'Cost of Revenue'),
    L('ic_cost', 'Cost of Revenue-Intercompany', ['IC_EXP'], 1),
    L('sal_direct', 'Salaries- Direct Tech', ['SAL_DIRECT'], 1),
    L('delivery_fte', 'Delivery FTE Costs', ['DELIVERY_FTE', 'COST_SERV'], 1),
    L('subs_direct', 'Dues and Subscriptions - Direct', ['SUBS_DIRECT'], 1),
    L('cost_acq', 'Cost of revenue from Acquisitions', ['COST_ACQ'], 1),
    T(
      'total_cor',
      'Total Cost of Revenue',
      'ic_cost + sal_direct + delivery_fte + subs_direct + cost_acq',
    ),
    T('gross_margin', 'Gross Margin', 'total_income - total_cor'),
    L('bu_mgmt', 'Dedicated BU Management', ['BU_MGMT'], 1),
    L('bu_sales', 'BU sales & Support', ['BU_SALES'], 1),
    L('sal_admin', 'Admin Salaries', ['SAL_ADMIN', 'EMP'], 1),
    L('corp_fin', 'Corporate Finance', ['CORP_FIN'], 1),
    L('corp_strat', 'Corporate Strategy', ['CORP_STRAT'], 1),
    L('sal_lead', 'Leadership Salary', ['SAL_LEAD'], 1),
    L('integ_tech', 'Integration /tech cost', ['INTEG_TECH'], 1),
    L('sales_mkt', 'Sales and Marketing', ['SALES_MKT'], 1),
    L('advisor', "Advisor's Fee", ['ADVISOR'], 1),
    L('legal', 'Legal and Compliance', ['PROF'], 1),
    L('rent', 'Rent & Utilities', ['RENT'], 1),
    L('hiring', 'Hiring Cost', ['HIRING'], 1),
    L('fundraise', 'Professional Fees for Fundraise and Advisory', ['FUNDRAISE'], 1),
    L('travel', 'Travel expenses', ['TRAVEL'], 1),
    L('subs', 'Dues and subscription', ['SOFTWARE'], 1),
    L('health_ins', 'Health insurance exp', ['HEALTH_INS'], 1),
    L('other_exp', 'Other Expenses', ['OTH_EXP', 'IC_DIFF_PL'], 1),
    T(
      'total_expenses',
      'Total Expenses',
      'bu_mgmt + bu_sales + sal_admin + corp_fin + corp_strat + sal_lead + integ_tech + sales_mkt + advisor + legal + rent + hiring + fundraise + travel + subs + health_ins + other_exp',
    ),
    T('ebitda', 'EBITDA', 'gross_margin - total_expenses'),
    L('depr', 'Depreciation and amortisation', ['DEPR']),
    L('finance', 'Finance costs', ['FIN_COST']),
    L('tax', 'Tax expense', ['TAX_CUR', 'TAX_DEF']),
    T('profit', 'Profit/Loss as per Standalone', 'ebitda - depr - finance - tax', 'PROFIT'),
  ],
  [
    H('ca_h', 'Current Assets'),
    L('cash', 'Cash and Cash Equivalents', ['CASH', 'BANK_OTH'], 1),
    L('ar', 'Accounts Receivable', ['TRADE_REC'], 1),
    L('investment', 'Investment', ['INV_SUB', 'CUR_INV'], 1),
    L('oca', 'Other Current Assets', ['CUR_OTH', 'IC_REC', 'CUR_FIN', 'TAX_ASSET', 'INVENTORY'], 1),
    T('total_ca', 'Total Current Assets', 'cash + ar + investment + oca'),
    H('nca_h', 'Non Current Assets'),
    L('ppe', 'Property, Plant and Equipments (Net)', ['PPE', 'CWIP', 'ROU', 'INTANG'], 1),
    L('pud', 'Product Under Development', ['PUD'], 1),
    L('other_asset', 'Other Asset', ['NC_OTH', 'NC_FIN', 'DTA'], 1),
    L('acq_cost', 'Other Assets (Acquisition, Organisation & Funding Cost)', ['ACQ_COST'], 1),
    L('goodwill', 'Goodwill(Acquisition)', ['GOODWILL'], 1),
    L('sec_dep', 'Security Deposits', ['SEC_DEP'], 1),
    T(
      'total_nca',
      'Total Non Current Assets',
      'ppe + pud + other_asset + acq_cost + goodwill + sec_dep',
    ),
    T('total_assets', 'Total Assets', 'total_ca + total_nca', 'TOTAL_ASSETS'),
    H('cl_h', 'Current Liabilities'),
    L('ap', 'Accounts Payable', ['TRADE_PAY'], 1),
    L('accrued', 'Accrued Expenses', ['ACCRUED_EXP'], 1),
    L('deferred', 'Deferred Revenue', ['DEFERRED_REV'], 1),
    L(
      'ocl',
      'Other Current Liabilities',
      ['CUR_OTH_LIAB', 'IC_PAY', 'CUR_FIN_LIAB', 'CUR_PROV', 'CUR_TAX_LIAB', 'LEASE_C', 'IC_DIFF'],
      1,
    ),
    T('total_cl', 'Total Current Liabilities', 'ap + accrued + deferred + ocl'),
    L('loan', 'Loan Payable-Others', ['LT_BORR', 'ST_BORR'], 1),
    L('oncl', 'Other Non Current Liabilities', ['LEASE_NC', 'NC_PROV', 'DTL'], 1),
    T('total_ltl', 'Long Term Liabilities', 'loan + oncl'),
    T('total_liabilities', 'Total Liabilities', 'total_cl + total_ltl'),
    H('equity_h', 'Shareholders Equity'),
    L('common', 'Common Shares', ['SHARE_CAP', 'SEC_PREM'], 1),
    L('reserves', 'Reserves & Surplus', ['OTH_RES'], 1),
    L('share_app', 'Share Application Money', ['SHARE_APP'], 1),
    L('sbc', 'Stock Compensation Reserve', ['SBC_RES'], 1),
    L('cye', 'Current Year Earnings', ['PROFIT', 'PL_NCI'], 1),
    L('retained', 'Retained Earnings', ['RETAINED'], 1),
    L('fctr', 'Foreign Currency Translation Reserve', ['FCTR'], 1),
    L('nci', 'Non-controlling Interests', ['NCI'], 1),
    T(
      'total_equity',
      'Total Shareholders Equity',
      'common + reserves + share_app + sbc + cye + retained + fctr + nci',
    ),
    T(
      'total_le',
      'Total Liabilities and Shareholders Equity',
      'total_liabilities + total_equity',
      'TOTAL_EQUITY_LIABILITIES',
    ),
  ],
);

export async function seedClientGroupings(prisma: PrismaClient): Promise<void> {
  if (await prisma.auditLog.findFirst({ where: MARKER })) return;

  const last = await prisma.fsli.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.fsli.createMany({
    data: CLIENT_FSLIS.map((f, i) => ({
      code: f.code,
      name: f.name,
      statement: f.statement,
      class: f.class,
      rateBasis: f.rateBasis,
      sortOrder: (last._max.sortOrder ?? 0) + i + 1,
    })),
    skipDuplicates: true,
  });

  // Every stored format line: each new FSLI next to its anchor.
  const lines = await prisma.formatLine.findMany();
  let placed = 0;
  for (const l of lines) {
    let fslis = [...l.fslis];
    for (const f of CLIENT_FSLIS) {
      if (fslis.includes(f.code)) continue;
      const at = fslis.indexOf(f.anchor);
      if (at < 0) continue;
      fslis = [...fslis.slice(0, at + 1), f.code, ...fslis.slice(at + 1)];
    }
    if (fslis.length !== l.fslis.length) {
      await prisma.formatLine.update({ where: { id: l.id }, data: { fslis } });
      placed++;
    }
  }

  // Management format → the client's layout (new version; open tasks move to it).
  const fslisNow = await prisma.fsli.findMany({ where: { isActive: true } });
  const issues = checkFormatCoverage(
    CLIENT_MANAGEMENT,
    fslisNow.map((f) => ({ code: f.code, name: f.name, statement: f.statement, class: f.class })),
  );
  if (issues.length > 0)
    throw new Error(`Client management layout: ${issues.map((i) => i.message).join(' ')}`);
  const format = await prisma.format.findUnique({ where: { code: 'MANAGEMENT' } });
  let version: number | null = null;
  if (format) {
    version = format.currentVersion + 1;
    await prisma.$transaction(async (tx) => {
      const v = await tx.formatVersion.create({
        data: {
          formatCode: 'MANAGEMENT',
          version: version!,
          note: "Client layout (Financials Aug'26 workbook: Aistra Group Entity Wise P&L / BS)",
        },
      });
      await tx.formatLine.createMany({ data: formatLineRows(v.id, CLIENT_MANAGEMENT) });
      await tx.format.update({
        where: { code: 'MANAGEMENT' },
        data: {
          name: 'Aistra management (client layout)',
          description:
            "The client's monthly management P&L down to EBITDA and balance sheet, line for line as in the Financials workbook (Aistra Group Entity Wise P&L / BS).",
          currentVersion: version!,
        },
      });
      await tx.task.updateMany({
        where: {
          formatCode: 'MANAGEMENT',
          NOT: {
            OR: [
              { entities: { some: { status: 'FINALISED' } } },
              { levels: { some: { status: 'FINALISED' } } },
            ],
          },
        },
        data: { formatVersion: version! },
      });
    });
  }

  await prisma.auditLog.create({
    data: {
      ...MARKER,
      newValue: {
        fslisCreated: created.count,
        formatLinesUpdated: placed,
        managementVersion: version,
      },
    },
  });
  console.log(
    `Client groupings: ${created.count} FSLIs added, ${placed} format lines updated, Management format → version ${version ?? '-'}.`,
  );
}
