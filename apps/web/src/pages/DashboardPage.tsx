import { Building2, CalendarDays, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useCurrentUser } from '@/auth/AuthContext';
import { PERMISSION_LABELS } from '@/auth/navigation';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const today = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Placeholder dashboard: greets the user and shows what they can do. */
export function DashboardPage() {
  const user = useCurrentUser();
  const firstName = user.name.split(/\s+/)[0] ?? user.name;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-sidebar px-6 py-7 text-white shadow-sm sm:px-8">
        <div
          aria-hidden
          className="absolute -top-24 -right-16 size-72 rounded-full bg-[#0E7C66] opacity-30 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm text-sidebar-muted">
              <CalendarDays className="size-4" /> {today.format(new Date())}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-1 max-w-2xl text-sidebar-muted">
              Welcome, {user.name}. Monthly close, standalone statements and consolidation for the
              Aistra group — dashboards arrive in a later step.
            </p>
          </div>
          <Badge className="border-white/20 bg-white/10 px-3 py-1 text-sm text-white">
            {user.isMaster
              ? 'Master admin'
              : `${user.permissions.length} permission${user.permissions.length === 1 ? '' : 's'}`}
          </Badge>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-teal" /> Your permissions
            </CardTitle>
            <CardDescription>
              {user.isMaster
                ? 'As master admin you have every permission.'
                : 'What your account is allowed to do.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {user.permissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No permissions yet. Ask a user administrator to grant access.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {user.permissions.map((code) => (
                  <li
                    key={code}
                    className="flex items-start gap-2.5 rounded-lg border bg-mint/40 px-3 py-2.5"
                  >
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" />
                    <span>
                      <span className="block text-sm font-medium text-ink">
                        {PERMISSION_LABELS[code] ?? code}
                      </span>
                      <code className="font-mono text-[11px] text-muted-foreground">{code}</code>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-teal" /> Entity access
              </CardTitle>
              <CardDescription>Entities whose data you can work with.</CardDescription>
            </CardHeader>
            <CardContent>
              {user.entityScope === null ? (
                <Badge variant="success">All entities</Badge>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {user.entityScope.map((code) => (
                    <Badge key={code} variant="outline">
                      {code}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Status colours</CardTitle>
              <CardDescription>Used for close tasks from the next steps.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <StatusBadge status="done" />
              <StatusBadge status="in-progress" />
              <StatusBadge status="not-started" />
              <StatusBadge status="overdue" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
