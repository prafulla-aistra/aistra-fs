import { CheckCircle2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dismissToast, subscribeToasts, type ToastItem } from '@/lib/toast';

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-center gap-3 rounded-lg bg-ink px-4 py-3 text-sm text-white shadow-lg animate-in slide-in-from-bottom-2"
        >
          <CheckCircle2 className="size-4 text-[#3FD0AE]" />
          {t.text}
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="rounded p-0.5 hover:bg-white/10"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
