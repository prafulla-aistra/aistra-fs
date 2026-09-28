import * as React from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-md border bg-background px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive';

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(fieldBase, 'h-9 py-1', className)} {...props} />;
}

function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select data-slot="select" className={cn(fieldBase, 'h-9 py-1 pr-8', className)} {...props} />
  );
}

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...props} />;
}

function Checkbox({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn('size-4 shrink-0 rounded border accent-primary disabled:opacity-50', className)}
      {...props}
    />
  );
}

/** Label + control + optional hint / error, stacked. */
function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Alert({
  variant = 'error',
  className,
  ...props
}: React.ComponentProps<'div'> & { variant?: 'error' | 'info' | 'success' }) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        variant === 'error' && 'border-destructive/30 bg-destructive/5 text-destructive',
        variant === 'info' && 'border-border bg-muted text-foreground',
        variant === 'success' && 'border-success/30 bg-success/10 text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, Checkbox, Field, Input, Label, Select };
