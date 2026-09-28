import { CheckCircle2 } from 'lucide-react';
import { useCurrentUser } from '@/auth/AuthContext';
import { PERMISSION_LABELS } from '@/auth/navigation';
import { PageHeader } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Placeholder dashboard: greets the user and shows what they can do. */
export function DashboardPage() {
  const user = useCurrentUser();
  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name}`}
        description="Monthly standalone and consolidated financial statements for the Aistra group. Dashboards arrive in a later step."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your permissions</CardTitle>
            <CardDescription>
              {user.isMaster
                ? 'You are the master admin and have every permission.'
                : 'What your account is allowed to do.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {user.permissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No permissions yet. Ask a user administrator to grant access.
              </p>
            ) : (
              <ul className="space-y-2">
                {user.permissions.map((code) => (
                  <li key={code} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-success" />
                      {PERMISSION_LABELS[code] ?? code}
                    </span>
                    <code className="font-mono text-xs text-muted-foreground">{code}</code>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Entity access</CardTitle>
            <CardDescription>Entities whose data you can work with.</CardDescription>
          </CardHeader>
          <CardContent>
            {user.entityScope === null ? (
              <Badge variant="secondary">All entities</Badge>
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
      </div>
    </>
  );
}
