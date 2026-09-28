import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { ComponentStatus } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getHealth } from '@/lib/api';

/** Placeholder landing page: confirms the web app can reach the API and the API can reach the DB. */
export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth });

  const api: ComponentStatus | 'checking' = health.isPending
    ? 'checking'
    : health.isError
      ? 'error'
      : 'ok';
  const db: ComponentStatus | 'checking' | 'unknown' = health.isPending
    ? 'checking'
    : health.data
      ? health.data.db
      : 'unknown';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance Close</h1>
        <p className="text-muted-foreground">
          Standalone and consolidated financial statements for the Aistra group. Business screens
          arrive in later steps.
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>System health</CardTitle>
          <CardDescription>
            Result of <code className="font-mono text-xs">GET /api/health</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-2 text-sm">
            <StatusRow label="API" status={api} />
            <StatusRow label="Database" status={db} />
          </dl>
          {health.isError && (
            <p className="text-sm text-destructive">
              Could not reach the API. Is it running on port 3000? ({health.error.message})
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void health.refetch()}
            disabled={health.isFetching}
          >
            <RefreshCw className={health.isFetching ? 'animate-spin' : undefined} />
            Check again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusRow({
  label,
  status,
}: {
  label: string;
  status: ComponentStatus | 'checking' | 'unknown';
}) {
  const variant = status === 'ok' ? 'success' : status === 'error' ? 'destructive' : 'secondary';
  return (
    <div className="flex items-center justify-between">
      <dt>{label}</dt>
      <dd>
        <Badge variant={variant}>{status}</Badge>
      </dd>
    </div>
  );
}
