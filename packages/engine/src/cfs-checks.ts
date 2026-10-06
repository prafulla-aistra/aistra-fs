import { amountText, type CheckResult, type RegisterEntry } from './checks';
import type { EliminationCheck } from './consolidation';
import { Decimal } from './money';

/**
 * CFS control checks (consolidation Review step, page 10). As for SFS, the register decides
 * which checks run with which severity and threshold; this module only evaluates them.
 */
export interface CfsCheckData {
  /** Members whose SFS is not finalised for the period. */
  membersNotFinalised: string[];
  generated: boolean;
  /** A fresh computation differs from the stored eliminations. */
  stale: boolean;
  /** Members whose SFS snapshot changed since the eliminations were generated. */
  membersChanged: string[];
  /** Entries that could not be generated (missing register rows, rates). */
  issues: string[];
  eliminationChecks: readonly EliminationCheck[];
  bs: { totalAssets: string | null; totalEquityLiabilities: string | null };
  profit: { profit: string | null; carried: string | null };
  attribution: { total: string; owners: string; nci: string };
  /** Flagged IC differences parked in IC_DIFF: entry title, amount, explained. */
  icDifferences: { title: string; amount: string; explained: boolean }[];
  notes: { visible: number; notReviewed: string[]; staleFlags: number };
  acquisitionsToBeConfirmed: string[];
  comparativePresent: boolean;
}

const countOk = (n: number, e: RegisterEntry) => new Decimal(n).lte(e.threshold ?? '0');
const within = (d: Decimal, e: RegisterEntry) => d.abs().lte(e.threshold ?? '0');
const list = (xs: string[], max = 6) =>
  xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', ');

export function runCfsChecks(
  data: CfsCheckData,
  register: readonly RegisterEntry[],
): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (e: RegisterEntry, r: Omit<CheckResult, 'code' | 'name' | 'severity' | 'currency'>) =>
    out.push({ code: e.code, name: e.name, severity: e.severity, currency: null, ...r });
  const tol = (e: RegisterEntry) =>
    e.thresholdUnit === 'AMOUNT' ? ` · tolerance ${amountText(e.threshold ?? '0')}` : '';
  const elim = (code: EliminationCheck['code']) =>
    data.eliminationChecks.find((c) => c.code === code);

  for (const e of register.filter((x) => x.isActive)) {
    switch (e.code) {
      case 'CFS_MEMBERS_FINALISED':
        add(e, {
          result: data.membersNotFinalised.length === 0 ? 'PASS' : 'FAIL',
          details: data.membersNotFinalised.length
            ? `Not finalised: ${list(data.membersNotFinalised)}.`
            : 'Every member’s SFS is finalised for the period.',
          link: { step: 'READINESS' },
        });
        break;
      case 'CFS_ELIMINATIONS_CURRENT': {
        const ok = data.generated && !data.stale && data.membersChanged.length === 0;
        add(e, {
          result: ok ? 'PASS' : 'FAIL',
          details: !data.generated
            ? 'Eliminations not generated.'
            : data.membersChanged.length
              ? `Member data changed since generation (${data.membersChanged.join(', ')}): regenerate the eliminations.`
              : data.stale
                ? 'The eliminations no longer match the data or configuration: regenerate.'
                : 'Generated from the members’ current snapshots.',
          link: { step: 'ELIMINATIONS' },
        });
        break;
      }
      case 'CFS_GENERATION_COMPLETE':
        add(e, {
          result: data.issues.length === 0 ? 'PASS' : 'FAIL',
          details: data.issues.length
            ? data.issues.join(' ')
            : 'Every elimination could be generated.',
          link: { step: 'ELIMINATIONS' },
        });
        break;
      case 'CFS_ENTRIES_BALANCE':
      case 'CFS_INVESTMENTS_ELIMINATED':
      case 'CFS_IC_ELIMINATED': {
        const code = e.code.replace('CFS_', '') as EliminationCheck['code'];
        const c = elim(code);
        add(e, {
          result: c ? (c.passed ? 'PASS' : 'FAIL') : 'FAIL',
          details: c?.details ?? 'Eliminations not generated.',
          link: { step: 'ELIMINATIONS' },
        });
        break;
      }
      case 'CFS_BS_BALANCES': {
        if (data.bs.totalAssets === null || data.bs.totalEquityLiabilities === null) {
          add(e, {
            result: 'FAIL',
            details: 'The format does not mark total assets and total equity and liabilities.',
            link: { step: 'STATEMENTS' },
          });
          break;
        }
        const d = new Decimal(data.bs.totalEquityLiabilities).minus(data.bs.totalAssets);
        add(e, {
          result: within(d, e) ? 'PASS' : 'FAIL',
          details: `Total assets ${amountText(data.bs.totalAssets)} · Total equity and liabilities ${amountText(data.bs.totalEquityLiabilities)} · difference ${amountText(d)}${tol(e)}`,
          link: { step: 'STATEMENTS' },
        });
        break;
      }
      case 'CFS_PROFIT_TIES': {
        if (data.profit.profit === null || data.profit.carried === null) {
          add(e, {
            result: 'FAIL',
            details: 'The format does not mark the profit line.',
            link: { step: 'STATEMENTS' },
          });
          break;
        }
        const d = new Decimal(data.profit.profit).minus(data.profit.carried);
        add(e, {
          result: within(d, e) ? 'PASS' : 'FAIL',
          details: `Profit ${amountText(data.profit.profit)} · carried to the balance sheet ${amountText(data.profit.carried)} · difference ${amountText(d)}${tol(e)}`,
          link: { step: 'STATEMENTS' },
        });
        break;
      }
      case 'CFS_ATTRIBUTION_TIES': {
        const d = new Decimal(data.attribution.owners)
          .plus(data.attribution.nci)
          .minus(data.attribution.total);
        add(e, {
          result: within(d, e) ? 'PASS' : 'FAIL',
          details: `Owners ${amountText(data.attribution.owners)} + NCI ${amountText(data.attribution.nci)} = ${amountText(new Decimal(data.attribution.owners).plus(data.attribution.nci))} · profit ${amountText(data.attribution.total)} · difference ${amountText(d)}`,
          link: { step: 'STATEMENTS' },
        });
        break;
      }
      case 'CFS_IC_DIFFERENCES_EXPLAINED': {
        // Decision round 1 (Q7): an IC difference above the pair tolerance is BLOCKING while
        // unexplained; once every one has an explanation it is a WARNING (acknowledged at submit).
        const missing = data.icDifferences.filter((x) => !x.explained);
        const any = data.icDifferences.length > 0;
        out.push({
          code: e.code,
          name: e.name,
          severity: !any ? e.severity : missing.length ? 'BLOCKING' : 'WARNING',
          currency: null,
          result: any ? 'FAIL' : 'PASS',
          details: !any
            ? 'No intercompany differences above the tolerances.'
            : missing.length
              ? `${missing.length} IC difference(s) above the tolerance without an explanation (blocking until explained): ${list(missing.map((m) => `${m.title} (${amountText(new Decimal(m.amount).abs())})`))}.`
              : `${data.icDifferences.length} IC difference(s) above the tolerance, each explained: acknowledge to submit.`,
          link: { step: 'ELIMINATIONS' },
        });
        break;
      }
      case 'CFS_NOTES_REVIEWED':
        add(e, {
          result: countOk(data.notes.notReviewed.length, e) ? 'PASS' : 'FAIL',
          details: `${data.notes.visible - data.notes.notReviewed.length} of ${data.notes.visible} notes reviewed${data.notes.notReviewed.length ? `; not reviewed: ${list(data.notes.notReviewed, 5)}` : ''}`,
          link: { step: 'NOTES', key: data.notes.notReviewed[0] },
        });
        break;
      case 'CFS_STALE_NUMBERS':
        add(e, {
          result: countOk(data.notes.staleFlags, e) ? 'PASS' : 'FAIL',
          details: `${data.notes.staleFlags} possible stale figure(s) in note text`,
          link: { step: 'NOTES' },
        });
        break;
      case 'CFS_ACQUISITIONS_CONFIRMED':
        add(e, {
          result: countOk(data.acquisitionsToBeConfirmed.length, e) ? 'PASS' : 'FAIL',
          details: data.acquisitionsToBeConfirmed.length
            ? `To be confirmed: ${list(data.acquisitionsToBeConfirmed)}.`
            : 'Acquisitions register confirmed.',
          link: { step: 'READINESS' },
        });
        break;
      case 'CFS_COMPARATIVE_PRESENT':
        add(e, {
          result: data.comparativePresent ? 'PASS' : 'FAIL',
          details: data.comparativePresent
            ? 'A comparative is available.'
            : 'No comparative: the statements show none.',
          link: { step: 'STATEMENTS' },
        });
        break;
      default:
        add(e, {
          result: 'NA',
          details: 'This check is not evaluated for consolidation.',
          link: { step: 'STATEMENTS' },
        });
    }
  }
  return out;
}
