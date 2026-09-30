import { CircleCheck, CircleX } from 'lucide-react';
import type { FsliSummaryDto, IntercompanyRowDto } from '@finance-close/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, Td, Th } from '@/components/ui/overlay';
import { bracketAmount } from '@/lib/format';

/** Totals per FSLI in functional currency (Dr positive, Cr in brackets), with profit. */
export function FsliSummaryCard({
  summary,
  currency,
}: {
  summary: FsliSummaryDto;
  currency: string;
}) {
  const group = (st: 'BS' | 'PL') => summary.rows.filter((r) => r.statement === st);
  return (
    <Card>
      <CardHeader>
        <CardTitle>FSLI summary</CardTitle>
        <CardDescription>{currency} · debits positive, credits in brackets</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <tbody>
            {(['BS', 'PL'] as const).map((st) => (
              <Group
                key={st}
                title={st === 'BS' ? 'Balance sheet' : 'Profit and loss'}
                rows={group(st)}
                total={st === 'BS' ? summary.bsTotal : summary.plTotal}
              />
            ))}
            {summary.unmapped !== '0.00' && (
              <tr className="bg-amber-50">
                <Td>Unmapped accounts</Td>
                <Td className="text-right font-mono tabular-nums">
                  {bracketAmount(summary.unmapped)}
                </Td>
              </tr>
            )}
            <tr className="font-semibold">
              <Td>Profit for the period</Td>
              <Td className="text-right font-mono tabular-nums">{bracketAmount(summary.profit)}</Td>
            </tr>
            <tr>
              <Td>
                <span className="inline-flex items-center gap-1.5">
                  {summary.nil ? (
                    <CircleCheck className="size-4 text-success" />
                  ) : (
                    <CircleX className="size-4 text-destructive" />
                  )}
                  FSLI total = TB total (nil)
                </span>
              </Td>
              <Td className="text-right font-mono tabular-nums">{bracketAmount(summary.total)}</Td>
            </tr>
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Profit for the period is the P&amp;L total with the sign reversed: a credit P&amp;L total
          is a profit.
        </p>
      </CardContent>
    </Card>
  );
}

function Group({
  title,
  rows,
  total,
}: {
  title: string;
  rows: FsliSummaryDto['rows'];
  total: string;
}) {
  return (
    <>
      <tr>
        <Th colSpan={2}>{title}</Th>
      </tr>
      {rows.map((r) => (
        <tr key={r.code}>
          <Td>{r.name}</Td>
          <Td className="text-right font-mono tabular-nums">{bracketAmount(r.amount)}</Td>
        </tr>
      ))}
      <tr className="font-medium">
        <Td>Total {title.toLowerCase()}</Td>
        <Td className="text-right font-mono tabular-nums">{bracketAmount(total)}</Td>
      </tr>
    </>
  );
}

/** Intercompany balances and flows by counterparty. */
export function IntercompanyCard({
  rows,
  currency,
}: {
  rows: IntercompanyRowDto[];
  currency: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Intercompany summary</CardTitle>
        <CardDescription>
          {currency}. These will be matched against the counterparty’s balances in consolidation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No intercompany accounts.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Counterparty</Th>
                <Th className="text-right">Receivable</Th>
                <Th className="text-right">Payable</Th>
                <Th className="text-right">Revenue</Th>
                <Th className="text-right">Charges</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.counterpartyCode}>
                  <Td>
                    <span className="font-mono text-xs font-semibold">{r.counterpartyCode}</span>{' '}
                    {r.counterpartyName}
                  </Td>
                  {(['receivable', 'payable', 'revenue', 'charges'] as const).map((k) => (
                    <Td key={k} className="text-right font-mono tabular-nums">
                      {r[k] === '0.00' ? '—' : bracketAmount(r[k])}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
