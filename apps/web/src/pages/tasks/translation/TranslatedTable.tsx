import { CircleCheck, CircleX } from 'lucide-react';
import { useState } from 'react';
import type { CurrencyTranslationDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { bracketAmount } from '@/lib/format';

/** The translated trial balance: every line with its basis and rate, then FCTR and totals. */
export function TranslatedTable({
  c,
  functional,
}: {
  c: CurrencyTranslationDto;
  functional: string;
}) {
  const [basis, setBasis] = useState('all');
  const labels = [...new Set(c.lines.map((l) => l.basisLabel))];
  const rows = c.lines.filter((l) => basis === 'all' || l.basisLabel === basis);
  const nil = (v: string | null) => v === '0.00';
  const Tick = ({ ok }: { ok: boolean }) =>
    ok ? (
      <CircleCheck className="size-4 text-success" aria-label="Nets to nil" />
    ) : (
      <CircleX className="size-4 text-destructive" />
    );
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>
          Translated trial balance ({functional} → {c.target})
        </CardTitle>
        <Select
          aria-label="Filter by rate basis"
          className="w-64"
          value={basis}
          onChange={(e) => setBasis(e.target.value)}
        >
          <option value="all">All rate bases</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      </CardHeader>
      <CardContent>
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Account</Th>
              <Th>FSLI</Th>
              <Th>Rate basis</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">{functional}</Th>
              <Th className="text-right">{c.target}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.code}>
                <Td className="font-mono text-xs">{l.code}</Td>
                <Td>{l.name}</Td>
                <Td className="text-xs">{l.fsliName}</Td>
                <Td className="text-xs whitespace-nowrap">
                  {l.basisLabel}
                  {l.overridden && (
                    <Badge variant="review" className="ml-1">
                      override
                    </Badge>
                  )}
                </Td>
                <Td className="text-right font-mono text-xs tabular-nums">
                  {l.rate ?? 'rolled forward'}
                </Td>
                <Td className="text-right font-mono tabular-nums">{bracketAmount(l.functional)}</Td>
                <Td className="text-right font-mono tabular-nums">{bracketAmount(l.translated)}</Td>
              </tr>
            ))}
            {basis === 'all' && (
              <tr className="bg-mint/50">
                <Td className="font-mono text-xs">FCTR</Td>
                <Td colSpan={2}>Foreign currency translation reserve (balancing, to equity)</Td>
                <Td className="text-xs">balancing</Td>
                <Td />
                <Td className="text-right font-mono tabular-nums">—</Td>
                <Td className="text-right font-mono tabular-nums font-medium">
                  {bracketAmount(c.fctr!)}
                </Td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <Td colSpan={5}>Total</Td>
              <Td className="text-right">
                <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                  <Tick ok={nil(c.totals.functional)} /> {bracketAmount(c.totals.functional)}
                </span>
              </Td>
              <Td className="text-right">
                <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                  <Tick ok={nil(c.totals.translated)} />{' '}
                  {bracketAmount(c.totals.translated ?? '0.00')}
                </span>
              </Td>
            </tr>
          </tfoot>
        </Table>
      </CardContent>
    </Card>
  );
}
