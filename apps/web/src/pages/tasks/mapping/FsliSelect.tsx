import type { EntityMappingDto } from '@finance-close/shared';
import { Select } from '@/components/ui/form';

type Options = EntityMappingDto['options'];

/** FSLI select grouped Balance sheet / Profit and loss (computed and consolidation-only excluded). */
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
    <Select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Choose FSLI…</option>
      {(['BS', 'PL'] as const).map((st) => (
        <optgroup key={st} label={st === 'BS' ? 'Balance sheet' : 'Profit and loss'}>
          {options.fslis
            .filter((f) => f.statement === st)
            .map((f) => (
              <option key={f.code} value={f.code}>
                {f.name} ({f.code})
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
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
