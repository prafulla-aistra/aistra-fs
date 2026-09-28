import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Closes on Escape and locks page scroll while an overlay is open. */
function useOverlay(open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Right-hand drawer, used for create/edit forms. */
function Sheet({ open, onClose, title, description, children, footer }: OverlayProps) {
  useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/30 animate-in fade-in-0" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l bg-background shadow-xl animate-in slide-in-from-right">
        <Header title={title} description={description} onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/** Centred dialog, used for confirmations and short forms. */
function Dialog({ open, onClose, title, description, children, footer }: OverlayProps) {
  useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/30 animate-in fade-in-0" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border bg-background shadow-xl animate-in zoom-in-95">
        <Header title={title} description={description} onClose={onClose} />
        <div className="px-6 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

function Header({
  title,
  description,
  onClose,
}: {
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Close"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

function Th({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 border-b bg-muted/50 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function Td({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('border-b px-3 py-2.5 align-middle', className)} {...props} />;
}

export { Dialog, Sheet, Table, Td, Th };
