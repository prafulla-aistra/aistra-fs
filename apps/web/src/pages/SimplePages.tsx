import { Construction, Lock } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Placeholder for pages built in later steps. */
export function ComingSoonPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
          <Construction className="size-5" />
          Coming in a later step.
        </CardContent>
      </Card>
    </>
  );
}

export function NotFoundPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">The address you opened does not exist.</p>
      <Button asChild variant="outline">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}

/** Shown when a user opens a page URL directly without the needed permission. */
export function NoAccessPage() {
  return (
    <Card className="max-w-lg">
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 font-semibold">
          <Lock className="size-4" /> You don't have access
        </div>
        <p className="text-sm text-muted-foreground">
          Your account does not have permission to open this page. If you need it, ask a user
          administrator to update your permissions.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
