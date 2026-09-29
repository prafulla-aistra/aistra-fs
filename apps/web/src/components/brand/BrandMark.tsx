import { cn } from '@/lib/utils';

/** Finance Close logo: a ledger page with ruled lines and a sign-off tick. Original artwork. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0E7C66" />
      <rect x="8" y="6.5" width="16" height="19" rx="2.5" fill="#E8F3EF" />
      <path
        d="M11 11.5h10M11 15h10M11 18.5h5"
        stroke="#0F2A3D"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity=".55"
      />
      <circle cx="22" cy="22" r="5.5" fill="#0F2A3D" />
      <path
        d="m19.6 22 1.7 1.7 3.2-3.4"
        fill="none"
        stroke="#E8F3EF"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Logo + product name, for dark (sidebar, login panel) or light backgrounds. */
export function BrandLockup({
  tone = 'dark',
  className,
}: {
  tone?: 'dark' | 'light';
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span
        className={cn(
          'text-[15px] font-semibold tracking-tight',
          tone === 'dark' ? 'text-white' : 'text-ink',
        )}
      >
        Finance Close
      </span>
    </div>
  );
}
