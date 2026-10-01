import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { NotificationsDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The bell: in-app notifications (submitted, query raised/answered, returned, finalised…). */
export function NotificationsBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsDto>('/notifications'),
    refetchInterval: 30_000,
  });
  const read = useMutation({
    mutationFn: (id: string | null) =>
      api.post(id ? `/notifications/${id}/read` : '/notifications/read-all'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={box}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-96 max-w-[90vw] rounded-lg border bg-card shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            <Button
              variant="link"
              size="sm"
              disabled={unread === 0}
              onClick={() => read.mutate(null)}
            >
              Mark all read
            </Button>
          </div>
          <ul className="max-h-96 overflow-auto">
            {(q.data?.items ?? []).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn(
                    'block w-full border-b px-3 py-2 text-left text-sm hover:bg-mint/60',
                    !n.read && 'bg-mint/40',
                  )}
                  onClick={() => {
                    if (!n.read) read.mutate(n.id);
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                >
                  <div className={cn(!n.read && 'font-medium')}>{n.title}</div>
                  {n.body && (
                    <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    {formatDateTime(n.createdAt)}
                  </div>
                </button>
              </li>
            ))}
            {q.data && q.data.items.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                No notifications.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
