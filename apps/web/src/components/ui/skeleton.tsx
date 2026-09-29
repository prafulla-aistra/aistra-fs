import { cn } from '@/lib/utils';

/** Grey placeholder shown while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} />;
}
