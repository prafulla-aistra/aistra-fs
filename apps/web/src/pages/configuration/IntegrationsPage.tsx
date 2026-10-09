import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, PlugZap, Unplug, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ZohoOrganisationDto, ZohoStatusDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { ConfigPage, EditButton } from './ConfigPage';

/**
 * Configuration → Integrations → Zoho Books: connect the one Zoho account and link each Zoho
 * entity to its organisation, so the upload step can fetch trial balances directly.
 */
export function IntegrationsPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = useQuery({
    queryKey: ['config', 'zoho'],
    queryFn: () => api.get<ZohoStatusDto>('/integrations/zoho'),
  });
  const s = status.data;
  const orgs = useQuery({
    queryKey: ['config', 'zoho', 'organisations'],
    queryFn: () => api.get<ZohoOrganisationDto[]>('/integrations/zoho/organizations'),
    enabled: !!s?.connected && s.canEdit,
    retry: false,
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (s) setDraft(Object.fromEntries(s.links.map((l) => [l.entityCode, l.organizationId ?? ''])));
  }, [s]);

  // Back from Zoho: ?zoho=connected or ?zohoError=…
  const returned = params.get('zoho');
  const returnedError = params.get('zohoError');
  useEffect(() => {
    if (returned === 'connected') toast('Zoho Books connected.');
  }, [returned]);

  const connect = useMutation({
    mutationFn: () => api.post<{ url: string }>('/integrations/zoho/connect'),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete<ZohoStatusDto>('/integrations/zoho'),
    onSuccess: async () => {
      toast('Zoho Books disconnected.');
      await qc.invalidateQueries({ queryKey: ['config', 'zoho'] });
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api.put<ZohoStatusDto>('/integrations/zoho/links', {
        links: Object.entries(draft).map(([entityCode, id]) => ({
          entityCode,
          organizationId: id || null,
        })),
      }),
    onSuccess: async () => {
      toast('Organisation links saved.');
      await qc.invalidateQueries({ queryKey: ['config', 'zoho'] });
    },
  });

  const suggestions = (orgs.data ?? []).filter((o) => o.suggestedFor);
  const applySuggestions = () =>
    setDraft((d) => {
      const next = { ...d };
      for (const o of suggestions)
        if (!next[o.suggestedFor!]) next[o.suggestedFor!] = o.organizationId;
      return next;
    });
  const dirty =
    !!s && s.links.some((l) => (l.organizationId ?? '') !== (draft[l.entityCode] ?? ''));
  const error = status.error ?? connect.error ?? disconnect.error ?? save.error ?? orgs.error;

  return (
    <ConfigPage
      title="Zoho Books"
      purpose="One Zoho account holds the organisations of every Zoho entity. Connect it once and link each entity to its organisation; preparers can then fetch an entity's trial balance for the task period instead of uploading a file."
      count={
        s
          ? `${s.links.filter((l) => l.organizationId).length} of ${s.links.length} entities linked`
          : null
      }
      action={
        s?.connected ? (
          <>
            <EditButton
              size="sm"
              variant="outline"
              disabled={connect.isPending}
              onClick={() => connect.mutate()}
            >
              <PlugZap /> Reconnect
            </EditButton>
            <EditButton
              size="sm"
              variant="outline"
              disabled={disconnect.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    'Disconnect Zoho Books? Preparers will have to upload trial balance files.',
                  )
                )
                  disconnect.mutate();
              }}
            >
              <Unplug /> Disconnect
            </EditButton>
          </>
        ) : (
          <EditButton
            size="sm"
            disabled={!s?.configured || connect.isPending}
            onClick={() => connect.mutate()}
          >
            <PlugZap /> {connect.isPending ? 'Opening Zoho…' : 'Connect Zoho Books'}
          </EditButton>
        )
      }
    >
      {returnedError && (
        <Alert>
          {returnedError}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              params.delete('zohoError');
              setParams(params, { replace: true });
            }}
          >
            Dismiss
          </button>
        </Alert>
      )}
      {error && <Alert>{errorMessage(error)}</Alert>}

      {s && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Connection
              {s.connected ? (
                <Badge variant="success">Connected</Badge>
              ) : (
                <Badge variant="neutral">Not connected</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {s.connected ? (
              <p>
                Connected by {s.connectedBy ?? 'unknown'} on {formatDateTime(s.connectedAt!)} · API{' '}
                <span className="font-mono text-xs">{s.apiDomain}</span>
              </p>
            ) : s.configured ? (
              <p className="text-muted-foreground">
                Connect signs in to Zoho (an administrator of the Zoho account) and grants read-only
                access to reports, settings and the chart of accounts.
              </p>
            ) : (
              <Alert variant="info">
                Zoho is not set up on the server yet. In the Zoho API Console create a “Server-based
                Applications” client, then set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in
                apps/api/.env and restart the app.
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">
              Redirect URI to register in the Zoho API Console:{' '}
              <span className="font-mono">{s.redirectUri}</span>
            </p>
          </CardContent>
        </Card>
      )}

      {s && (
        <section className="space-y-2" aria-label="Organisation links">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Entity → Zoho organisation</h3>
            <div className="flex gap-2">
              {suggestions.length > 0 && (
                <EditButton size="sm" variant="outline" onClick={applySuggestions}>
                  <Wand2 /> Match by name
                </EditButton>
              )}
              <EditButton
                size="sm"
                disabled={!dirty || save.isPending || !s.connected}
                onClick={() => save.mutate()}
              >
                <Link2 /> {save.isPending ? 'Saving…' : 'Save links'}
              </EditButton>
            </div>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Entity</Th>
                <Th>Zoho organisation</Th>
              </tr>
            </thead>
            <tbody>
              {s.links.map((l) => {
                const suggested = orgs.data?.find((o) => o.suggestedFor === l.entityCode);
                return (
                  <tr key={l.entityCode}>
                    <Td>
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        {l.entityCode}
                      </span>{' '}
                      {l.legalName}
                    </Td>
                    <Td>
                      {s.canEdit && s.connected && orgs.data ? (
                        <Select
                          aria-label={`Zoho organisation of ${l.entityCode}`}
                          className="h-8 max-w-sm text-sm"
                          value={draft[l.entityCode] ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [l.entityCode]: e.target.value }))
                          }
                        >
                          <option value="">Not linked</option>
                          {orgs.data.map((o) => (
                            <option key={o.organizationId} value={o.organizationId}>
                              {o.name}
                              {o.currencyCode ? ` (${o.currencyCode})` : ''}
                              {o.organizationId === suggested?.organizationId
                                ? ' · name matches'
                                : ''}
                            </option>
                          ))}
                        </Select>
                      ) : l.organizationName ? (
                        l.organizationName
                      ) : (
                        <span className="text-muted-foreground">Not linked</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Veracity entities use Xero, which is not connected yet; their trial balances are
            uploaded as files.
          </p>
        </section>
      )}
    </ConfigPage>
  );
}
