import type { ReactNode } from 'react';
import type { ItemStatus } from '@finance-close/shared';
import { ItemStatusBadge } from '@/components/ui/badge';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';

export interface EntityTab {
  code: string;
  shortName: string;
  itemStatus: ItemStatus;
  hasValidatedTb: boolean;
}

/** Tabs for each entity (a dropdown on small screens), with a per-step marker. */
export function EntityTabs<T extends EntityTab>({
  entities,
  selected,
  onSelect,
  marker,
  markerText,
}: {
  entities: readonly T[];
  selected: string;
  onSelect: (code: string) => void;
  /** Badge after the name, e.g. ✓ or "2 to map". */
  marker: (e: T) => ReactNode;
  /** The same as text, for the small-screen dropdown. */
  markerText: (e: T) => string;
}) {
  return (
    <>
      <Select
        className="md:hidden"
        aria-label="Entity"
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
      >
        {entities.map((e) => (
          <option key={e.code} value={e.code}>
            {e.code} · {e.shortName} — {markerText(e)}
          </option>
        ))}
      </Select>
      <div role="tablist" aria-label="Entities" className="hidden flex-wrap gap-1 border-b md:flex">
        {entities.map((e) => (
          <button
            key={e.code}
            role="tab"
            type="button"
            aria-selected={e.code === selected}
            onClick={() => onSelect(e.code)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm',
              e.code === selected
                ? 'border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="font-mono text-xs font-semibold">{e.code}</span>
            {e.shortName}
            <ItemStatusBadge status={e.itemStatus} />
            {marker(e)}
          </button>
        ))}
      </div>
    </>
  );
}
