import { useMutation, useQuery } from '@tanstack/react-query';
import type { RateFetchPreviewDto, RateSaveResultDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';

const STATUS: Record<
  RateFetchPreviewDto['rows'][number]['status'],
  { label: string; variant: 'success' | 'warning' | 'neutral' | 'destructive' }
> = {
  NEW: { label: 'New', variant: 'success' },
  CHANGED: { label: 'Changes stored rate', variant: 'warning' },
  UNCHANGED: { label: 'Already stored', variant: 'neutral' },
  LOCKED: { label: 'Locked', variant: 'neutral' },
  ERROR: { label: 'Not available', variant: 'destructive' },
};

const monthLabel = (m: string) =>
  new Date(`${m}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Free API: the rates of the selected months, previewed before anything is saved. */
export function FetchRatesDialog({
  months,
  currencies,
  onClose,
  onSaved,
}: {
  months: string[];
  currencies: string[];
  onClose: () => void;
  onSaved: (r: RateSaveResultDto) => void;
}) {
  const body = { months, currencies };
  const preview = useQuery({
    queryKey: ['rate-fetch', months, currencies],
    queryFn: () => api.post<RateFetchPreviewDto>('/exchange-rates/fetch', body),
    retry: false,
    staleTime: 0,
  });
  const save = useMutation({
    mutationFn: () => api.post<RateSaveResultDto>('/exchange-rates/fetch/confirm', body),
    onSuccess: (r) => {
      onSaved(r);
      onClose();
    },
  });
  const p = preview.data;
  const toSave = p?.rows.filter((r) => r.status === 'NEW' || r.status === 'CHANGED').length ?? 0;
  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title={`Fetch rates from the free API – ${months.map(monthLabel).join(', ')}`}
      description="Units of currency per 1 USD. Nothing is saved until you click Save."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!p?.canSave || save.isPending} onClick={() => save.mutate()}>
            Save {toSave} month{toSave === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {(preview.error || save.error) && (
          <Alert>{errorMessage(preview.error ?? save.error)}</Alert>
        )}
        {preview.isLoading && (
          <p className="text-muted-foreground">Fetching daily rates… (a few seconds)</p>
        )}
        {p && (
          <>
            <p className="text-xs text-muted-foreground">{p.method}</p>
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Month</Th>
                    <Th>Currency</Th>
                    <Th className="text-right">Opening</Th>
                    <Th className="text-right">Closing</Th>
                    <Th className="text-right">Average</Th>
                    <Th>Based on</Th>
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={`${r.month}:${r.currency}`} className="align-top">
                      <Td>{monthLabel(r.month)}</Td>
                      <Td className="font-mono">{r.currency}</Td>
                      {(['opening', 'closing', 'average'] as const).map((k) => (
                        <Td key={k} className="text-right tabular-nums">
                          {r[k] ?? '–'}
                          {r.current && r.current[k] !== null && r.status === 'CHANGED' && (
                            <div className="text-xs text-muted-foreground">
                              stored {r.current[k]}
                            </div>
                          )}
                        </Td>
                      ))}
                      <Td className="text-xs">
                        <div>{r.source.replace('Free API: ', '')}</div>
                        {r.closingDate && (
                          <div className="text-muted-foreground">
                            {r.days} working days · close {formatDate(r.closingDate)}
                            {r.openingDate && ` · open ${formatDate(r.openingDate)}`}
                          </div>
                        )}
                      </Td>
                      <Td className="text-xs">
                        <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                        {r.problems.map((x) => (
                          <div key={x} className="mt-1 text-muted-foreground">
                            {x}
                          </div>
                        ))}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
