import { useMemo, useState } from 'react';
import type { CatalogItemDto, FigureRefDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';
import { SearchBox } from '../../configuration/common';
import { figureDisplay } from './figures';

const MEASURES: { code: FigureRefDto['measure']; label: string }[] = [
  { code: 'current', label: 'Current period' },
  { code: 'comparative', label: 'Comparative period' },
  { code: 'variance', label: 'Variance' },
  { code: 'variancePct', label: 'Variance %' },
];

/** Pick a statement line, FSLI, account or sub-caption and a measure: a live figure. */
export function FigurePicker({
  catalog,
  indian,
  title,
  onPick,
  onClose,
}: {
  catalog: CatalogItemDto[];
  indian: boolean;
  title: string;
  onPick: (ref: FigureRefDto) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [measure, setMeasure] = useState<FigureRefDto['measure']>('current');
  const [picked, setPicked] = useState<CatalogItemDto | null>(null);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      catalog
        .filter((c) => !q || c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q))
        .slice(0, 80),
    [catalog, q],
  );
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={title}
      description="The figure stays live: it always shows the correct amount in the selected currency and units, and updates when the note is rolled forward."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!picked}
            onClick={() => picked && onPick({ source: picked.source, key: picked.key, measure })}
          >
            Insert figure
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Search lines, FSLIs, accounts"
          />
          <div className="w-48">
            <Field label="Figure" htmlFor="fig-measure">
              <Select
                id="fig-measure"
                value={measure}
                onChange={(e) => setMeasure(e.target.value as FigureRefDto['measure'])}
              >
                {MEASURES.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
        <div
          className="max-h-80 space-y-3 overflow-y-auto rounded-md border p-2"
          role="listbox"
          aria-label="Figures"
        >
          {groups.map((g) => (
            <div key={g}>
              <p className="px-1 text-xs font-semibold text-muted-foreground">{g}</p>
              {rows
                .filter((r) => r.group === g)
                .map((r) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={picked === r}
                    key={`${r.source}:${r.key}`}
                    onClick={() => setPicked(r)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-sm hover:bg-accent',
                      picked === r && 'bg-mint',
                    )}
                  >
                    <span>{r.label}</span>
                    <span className="font-mono text-xs tabular-nums">
                      {figureDisplay({ source: r.source, key: r.key, measure }, catalog, indian)}
                    </span>
                  </button>
                ))}
            </div>
          ))}
          {rows.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">Nothing matches.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
