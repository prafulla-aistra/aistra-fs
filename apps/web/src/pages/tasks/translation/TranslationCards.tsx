import { CircleCheck, CircleX } from 'lucide-react';
import type { CurrencyTranslationDto, TranslationRateDto } from '@finance-close/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, Td } from '@/components/ui/overlay';
import { amountText, bracketAmount } from '@/lib/format';

export function RatesCard({
  c,
  functional,
  periodLabel,
  showMonths,
}: {
  c: CurrencyTranslationDto;
  functional: string;
  periodLabel: string;
  showMonths: boolean;
}) {
  const rows: [string, TranslationRateDto, string][] = [
    ['Opening', c.rates.opening, 'other reserves; retained earnings when not rolled forward'],
    ['Closing', c.rates.closing, 'assets and liabilities'],
    ['Average', c.rates.average, 'income and expenses'],
    ['Historical', c.rates.historical, 'share capital and premium'],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rates for {periodLabel}</CardTitle>
        <CardDescription>
          1 {functional} = X {c.target}. Used at full precision; shown to 10 decimals.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <tbody>
            {rows.map(([label, r, used]) => (
              <tr key={label}>
                <Td className="font-medium">{label}</Td>
                <Td className="text-right font-mono tabular-nums" title={r.formula ?? undefined}>
                  {r.value ?? <span className="text-destructive">Missing</span>}
                </Td>
                <Td className="text-xs text-muted-foreground">
                  {used}
                  {showMonths &&
                    r.sourceMonths.length > 0 &&
                    ` · from ${r.sourceMonths.join(', ')}`}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function SummaryCard({ c }: { c: CurrencyTranslationDto }) {
  const s = c.summary!;
  const row = (label: string, value: string, strong = false) => (
    <tr className={strong ? 'font-semibold' : undefined}>
      <Td>{label}</Td>
      <Td className="text-right font-mono tabular-nums">{bracketAmount(value)}</Td>
    </tr>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary in {c.target}</CardTitle>
        <CardDescription>
          Liabilities and equity shown as credits; a debit in brackets.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <tbody>
            {row('Total assets', s.totalAssets, true)}
            {row('Total liabilities', s.totalLiabilities, true)}
            {row('Share capital and premium', s.shareCapitalAndPremium)}
            {row('Retained earnings', s.retainedEarnings)}
            {row('Other reserves', s.otherReserves)}
            {row('Profit for the period', s.profit)}
            {row('Foreign currency translation reserve (FCTR)', s.fctr)}
            {row('Total equity', s.totalEquity, true)}
            <tr>
              <Td colSpan={2}>
                <span className="inline-flex items-center gap-1.5 text-sm">
                  {s.balanced ? (
                    <CircleCheck className="size-4 text-success" />
                  ) : (
                    <CircleX className="size-4 text-destructive" />
                  )}
                  Assets = liabilities + equity
                </span>
              </Td>
            </tr>
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function FctrMovement({
  c,
  periodLabel,
}: {
  c: CurrencyTranslationDto;
  periodLabel: string;
}) {
  const m = c.fctrMovement;
  const drCr = (v: string) =>
    `${amountText(v.replace('-', ''))} ${v.startsWith('-') ? 'Cr' : 'Dr'}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>FCTR movement</CardTitle>
        <CardDescription>{c.fctrMovementNote}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {m ? (
          <p>
            FCTR {periodLabel} <span className="font-mono">{drCr(m.current)}</span> less FCTR{' '}
            {m.comparativeLabel} <span className="font-mono">{drCr(m.comparative)}</span> ={' '}
            <strong className="font-mono">{drCr(m.movement)}</strong>
            {m.movement.startsWith('-') ? ' (credit movement)' : ' (debit movement)'}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Not available: the comparative is not finalised in {c.target}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
