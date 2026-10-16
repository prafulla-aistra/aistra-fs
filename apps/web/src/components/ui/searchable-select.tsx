import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export interface SearchableOption {
  value: string;
  label: string;
  /** Shown small after the label (e.g. the FSLI code); also searched. */
  hint?: string;
  group?: string;
}

const LIST_MAX = 256; // px: about 9 rows

/**
 * A select with a search box: the list opens below (or above when there is no room), at most
 * ~9 rows high and scrolls; typing filters by label or hint. Keyboard: ↑ ↓ to move, Enter to
 * choose, Esc to close. The list is rendered on top of the page, so tables and dialogs do not
 * clip it.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Choose…',
  label,
  disabled,
  className,
  size = 'md',
}: {
  options: readonly SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name. */
  label: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean }>();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter((o) =>
          `${o.label} ${o.hint ?? ''} ${o.group ?? ''}`.toLowerCase().includes(q),
        )
      : options;
  }, [options, query]);

  const place = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, 300);
    const below = window.innerHeight - r.bottom;
    const up = below < LIST_MAX + 60 && r.top > below;
    setPos({
      left: Math.min(r.left, window.innerWidth - width - 8),
      top: up ? r.top - 4 : r.bottom + 4,
      width,
      up,
    });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const move = () => place();
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', move);
    window.addEventListener('scroll', move, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', move);
      window.removeEventListener('scroll', move, true);
    };
  }, [open]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (o: SearchableOption) => {
    onChange(o.value);
    setOpen(false);
    button.current?.focus();
  };

  const openList = () => {
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openList();
          }
        }}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-left shadow-xs outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
          {selected?.hint && <span className="ml-1 text-muted-foreground">({selected.hint})</span>}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            className="fixed z-[60] rounded-md border bg-card shadow-lg"
            style={{
              left: pos.left,
              width: pos.width,
              ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
          >
            <div className="flex items-center gap-2 border-b px-2">
              <Search className="size-4 text-muted-foreground" />
              <input
                autoFocus
                aria-label={`Search ${label}`}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Type to search…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, shown.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const o = shown[active];
                    if (o) choose(o);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    button.current?.focus();
                  } else if (e.key === 'Tab') setOpen(false);
                }}
              />
            </div>
            <ul
              ref={list}
              role="listbox"
              aria-label={label}
              className="overflow-y-auto py-1"
              style={{ maxHeight: LIST_MAX }}
            >
              {shown.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted-foreground">No match</li>
              )}
              {shown.map((o, i) => {
                const heading = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                return (
                  <li key={o.value} role="presentation">
                    {heading && (
                      <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {heading}
                      </div>
                    )}
                    <div
                      role="option"
                      aria-selected={o.value === value}
                      data-index={i}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(o)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                        i === active && 'bg-mint',
                      )}
                    >
                      <Check
                        className={cn(
                          'size-3.5 shrink-0 text-primary',
                          o.value !== value && 'invisible',
                        )}
                      />
                      <span className="truncate">{o.label}</span>
                      {o.hint && (
                        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                          {o.hint}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
