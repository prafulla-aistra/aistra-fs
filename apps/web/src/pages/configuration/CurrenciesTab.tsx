import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { CurrencyDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { SearchBox } from './common';
import { matches, useCanEditConfig, useCurrencies } from './hooks';

export function CurrenciesTab() {
  const canEdit = useCanEditConfig();
  const currencies = useCurrencies();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<{ currency?: CurrencyDto } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: ({
      c,
      action,
    }: {
      c: CurrencyDto;
      action: 'activate' | 'deactivate' | 'delete';
    }) =>
      action === 'delete'
        ? api.delete(`/config/currencies/${c.code}`)
        : api.patch(`/config/currencies/${c.code}`, { isActive: action === 'activate' }),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (_d, { c, action }) => {
      setNotice(
        `${c.code} ${action === 'delete' ? 'deleted' : action === 'activate' ? 'reactivated' : 'deactivated'}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const rows = (currencies.data ?? []).filter((c) => matches(query, c.code, c.name));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={query} onChange={setQuery} placeholder="Search currencies" />
        {canEdit && (
          <Button onClick={() => setDialog({})}>
            <Plus /> Add currency
          </Button>
        )}
      </div>
      {notice && <Alert variant="success">{notice}</Alert>}
      {(error || currencies.error) && <Alert>{error ?? errorMessage(currencies.error)}</Alert>}
      <Table>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Symbol</Th>
            <Th>Status</Th>
            <Th>Used by</Th>
            {canEdit && <Th className="text-right">Actions</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.code} className="hover:bg-muted/30">
              <Td className="font-mono font-medium">{c.code}</Td>
              <Td>{c.name}</Td>
              <Td>{c.symbol}</Td>
              <Td>
                {c.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </Td>
              <Td className="font-mono text-xs text-muted-foreground">
                {c.usedBy.join(', ') || '—'}
              </Td>
              {canEdit && (
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ currency: c })}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({ c, action: c.isActive ? 'deactivate' : 'activate' })
                      }
                    >
                      {c.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                    {c.usedBy.length === 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ c, action: 'delete' })}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="text-xs text-muted-foreground">
        A currency used by any entity cannot be deleted; deactivate it instead. A currency used by
        an active entity cannot be deactivated either.
      </p>
      {dialog && (
        <CurrencyDialog
          currency={dialog.currency}
          onClose={() => setDialog(null)}
          onSaved={(c) => {
            setDialog(null);
            setNotice(`Saved ${c.code}.`);
            void queryClient.invalidateQueries({ queryKey: ['config'] });
          }}
        />
      )}
    </div>
  );
}

function CurrencyDialog({
  currency,
  onClose,
  onSaved,
}: {
  currency?: CurrencyDto;
  onClose: () => void;
  onSaved: (c: CurrencyDto) => void;
}) {
  const [code, setCode] = useState(currency?.code ?? '');
  const [name, setName] = useState(currency?.name ?? '');
  const [symbol, setSymbol] = useState(currency?.symbol ?? '');
  const save = useMutation({
    mutationFn: () =>
      currency
        ? api.patch<CurrencyDto>(`/config/currencies/${currency.code}`, { name, symbol })
        : api.post<CurrencyDto>('/config/currencies', { code, name, symbol }),
    onSuccess: onSaved,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={currency ? `Edit ${currency.code}` : 'Add currency'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="currency-form" disabled={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="currency-form" onSubmit={submit} className="space-y-4" noValidate>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {!currency && (
          <Field label="Code" htmlFor="c-code" hint="3-letter ISO 4217 code, e.g. EUR.">
            <Input
              id="c-code"
              className="font-mono uppercase"
              maxLength={3}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
          </Field>
        )}
        <Field label="Name" htmlFor="c-name">
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Symbol" htmlFor="c-symbol">
          <Input id="c-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
