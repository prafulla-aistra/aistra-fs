import { AlertTriangle, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/form';

/** Amber "To be confirmed" badge, with the note as a tooltip. */
export function TbcBadge({ note }: { note?: string | null }) {
  return (
    <Badge
      variant="outline"
      className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
      title={note ?? undefined}
    >
      To be confirmed
    </Badge>
  );
}

export function WarningText({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </span>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
        aria-label={placeholder}
      />
    </div>
  );
}

export function ComingNextStep({ title }: { title: string }) {
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{title}</span> — coming in the next step.
    </div>
  );
}
