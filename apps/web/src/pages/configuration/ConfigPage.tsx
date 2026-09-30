import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { NO_CONFIG_ACCESS, useCanEditConfig } from './hooks';

/** Every configuration page: title, one-line purpose, a count and the primary action. */
export function ConfigPage({
  title,
  purpose,
  count,
  action,
  children,
}: {
  title: string;
  purpose: string;
  /** e.g. "7 entities" */
  count?: string | null;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 flex-1 space-y-4" aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {purpose}
            {count && <span className="ml-2 font-medium text-foreground">· {count}</span>}
          </p>
        </div>
        {action && <div className="flex flex-wrap gap-2">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/**
 * A button that changes configuration. Users without CONFIG_MANAGE still see it, disabled,
 * with a tooltip explaining why (never hidden).
 */
export function EditButton({
  className,
  disabled,
  title,
  ...props
}: ComponentProps<typeof Button>) {
  const canEdit = useCanEditConfig();
  if (canEdit) return <Button className={className} disabled={disabled} title={title} {...props} />;
  return (
    // A disabled button gets no hover events, so the tooltip sits on a focusable wrapper.
    <span
      className={cn('inline-flex cursor-not-allowed', className)}
      title={NO_CONFIG_ACCESS}
      tabIndex={0}
      aria-label={NO_CONFIG_ACCESS}
    >
      <Button {...props} disabled aria-disabled className="pointer-events-none" />
    </span>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
