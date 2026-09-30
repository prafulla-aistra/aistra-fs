import { Link } from 'react-router';
import type { MappingRatesDto, RateValueDto } from '@finance-close/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, Td, Th } from '@/components/ui/overlay';

const KINDS = [
  ['opening', 'Opening'],
  ['closing', 'Closing'],
  ['average', 'Average'],
  ['historical', 'Historical (equity)'],
] as const;

/** "1 <functional> = X <target>" per translated currency, derived from the USD rate master. */
export function RatesCard({
  rates,
  onUpload,
}: {
  rates: MappingRatesDto;
  taskId: string;
  onUpload: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exchange rates for {rates.periodLabel}</CardTitle>
        <CardDescription>
          Cross rates from the USD rate master: A→B = (units of B per USD) ÷ (units of A per USD).
          Rate source: <span className="font-medium text-foreground">{rates.sourceLabel}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rates.noTranslation ? (
          <p className="text-sm">{rates.noTranslation}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Rate</Th>
                {KINDS.map(([k, label]) => (
                  <Th key={k} className="text-right">
                    {label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.rows.map((r) => (
                <tr key={r.target}>
                  <Td className="whitespace-nowrap">
                    1 {rates.functionalCurrency} = X {r.target}
                  </Td>
                  {KINDS.map(([k]) => (
                    <Td key={k} className="text-right">
                      <RateCell
                        v={r[k]}
                        fix={
                          k === 'historical' ? (
                            <Link to="/configuration/entities">Set in entity master</Link>
                          ) : (
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={onUpload}
                            >
                              Add rate
                            </button>
                          )
                        }
                      />
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <ul className="grid gap-x-6 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
          {rates.appliedTo.map((a) => (
            <li key={a.kind}>Applied to: {a.text}</li>
          ))}
        </ul>
        {rates.assumption && <p className="text-xs text-warning-foreground">{rates.assumption}</p>}
      </CardContent>
    </Card>
  );
}

function RateCell({ v, fix }: { v: RateValueDto; fix: React.ReactNode }) {
  if (v.value === null) {
    return (
      <span
        className="inline-flex flex-col items-end text-xs text-destructive"
        title={v.missing.join('\n')}
      >
        Missing
        <span className="font-medium">{fix}</span>
      </span>
    );
  }
  return (
    <span className="font-mono tabular-nums" title={v.formula ?? undefined}>
      {v.value}
    </span>
  );
}
