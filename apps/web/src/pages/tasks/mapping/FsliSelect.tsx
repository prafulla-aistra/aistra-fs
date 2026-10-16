import type { EntityMappingDto } from '@finance-close/shared';
import { Select } from '@/components/ui/form';
import { SearchableSelect } from '@/components/ui/searchable-select';

type Options = EntityMappingDto['options'];

/** Searchable FSLI select, grouped Balance sheet / Profit and loss (computed and consolidation-only excluded). */
export function FsliSelect({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: Options;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <SearchableSelect
      label={label}
      value={value}
      disabled={disabled}
      onChange={onChange}
      placeholder="Choose FSLI…"
      options={(['BS', 'PL'] as const).flatMap((st) =>
        options.fslis
          .filter((f) => f.statement === st)
          .map((f) => ({
            value: f.code,
            label: f.name,
            hint: f.code,
            group: st === 'BS' ? 'Balance sheet' : 'Profit and loss',
          })),
      )}
    />
  );
}

export function CounterpartySelect({
  options,
  value,
  onChange,
  investment,
  label,
}: {
  options: Options;
  value: string;
  onChange: (v: string) => void;
  /** INV_SUB: only direct subsidiaries. */
  investment: boolean;
  label: string;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose entity…</option>
      {options.counterparties
        .filter((c) => !investment || c.directSubsidiary)
        .map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
    </Select>
  );
}

export function AccountTypeSelect({
  options,
  value,
  onChange,
  label,
}: {
  options: Options;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose type…</option>
      {options.accountTypes.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </Select>
  );
}
