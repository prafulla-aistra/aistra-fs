import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        // Tinted status badges: coloured text on a light fill keeps AA contrast.
        success: 'border-success/25 bg-mint text-success',
        warning: 'border-warning/40 bg-amber-50 text-warning-foreground',
        destructive: 'border-destructive/25 bg-red-50 text-destructive',
        neutral: 'border-neutral/25 bg-slate-100 text-slate-700',
        outline: 'border-border bg-card text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

/** Task status with its colour dot: done, in progress, not started, overdue. */
export type WorkStatus = 'done' | 'in-progress' | 'not-started' | 'overdue';
const STATUS: Record<
  WorkStatus,
  { label: string; variant: 'success' | 'warning' | 'neutral' | 'destructive'; dot: string }
> = {
  done: { label: 'Done', variant: 'success', dot: 'bg-success' },
  'in-progress': { label: 'In progress', variant: 'warning', dot: 'bg-warning' },
  'not-started': { label: 'Not started', variant: 'neutral', dot: 'bg-neutral' },
  overdue: { label: 'Overdue', variant: 'destructive', dot: 'bg-destructive' },
};

function StatusBadge({ status, label }: { status: WorkStatus; label?: string }) {
  const s = STATUS[status];
  return (
    <Badge variant={s.variant}>
      <span className={cn('size-1.5 rounded-full', s.dot)} aria-hidden />
      {label ?? s.label}
    </Badge>
  );
}

export { Badge, StatusBadge };
