import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FlaskConical } from 'lucide-react';
import type { DemoAccountDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';

const ROLE_STYLE: Record<string, string> = {
  'Master admin': 'border-ink/20 bg-ink text-white',
  Preparer: 'border-teal/25 bg-mint text-teal',
  Reviewer: 'border-warning/40 bg-amber-50 text-warning-foreground',
  Viewer: 'border-neutral/25 bg-slate-100 text-slate-700',
};

/**
 * One-click demo sign-in. The API only has these endpoints when DEMO_MODE=true; otherwise
 * it answers 404 and this panel renders nothing.
 */
export function DemoAccounts({
  onPick,
  busyEmail,
}: {
  onPick: (email: string) => void;
  busyEmail: string | null;
}) {
  const accounts = useQuery({
    queryKey: ['demo-accounts'],
    queryFn: async () => {
      try {
        return await api.get<DemoAccountDto[]>('/auth/demo-accounts');
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return []; // demo mode off
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  if (!accounts.data?.length) return null;

  return (
    <section aria-labelledby="demo-accounts-title" className="space-y-3">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-teal" />
        <h2 id="demo-accounts-title" className="text-sm font-semibold">
          Demo accounts
        </h2>
        <span className="text-xs text-muted-foreground">— click to sign in instantly</span>
      </div>
      <div className="grid gap-2">
        {accounts.data.map((a) => (
          <button
            key={a.email}
            type="button"
            onClick={() => onPick(a.email)}
            disabled={busyEmail !== null}
            className={cn(
              'group flex items-center gap-3 rounded-lg border bg-card p-3 text-left shadow-xs transition-all hover:border-teal/50 hover:bg-mint/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60',
              busyEmail === a.email && 'border-teal bg-mint/60',
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-mint text-sm font-semibold text-teal">
              {a.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-ink">{a.name}</span>
                <Badge variant="outline" className={cn('px-1.5 text-[10.5px]', ROLE_STYLE[a.role])}>
                  {a.role}
                </Badge>
              </span>
              <span className="block truncate text-xs text-muted-foreground">{a.email}</span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-teal" />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Demo mode is on. It is for local testing only and is switched off in production.
      </p>
    </section>
  );
}
