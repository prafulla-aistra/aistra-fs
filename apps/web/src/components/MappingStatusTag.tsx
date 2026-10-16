import { MAPPING_STATUS, type MappingStatusCode } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Coloured tag for how an account's mapping stands: green from the client groupings, amber not
 * in the groupings / auto-suggested, red unmapped / counterparty missing. The tooltip says what
 * to do (and which grouping it came from).
 */
export function MappingStatusTag({
  status,
  grouping,
  className,
}: {
  status: MappingStatusCode;
  grouping?: string | null;
  className?: string;
}) {
  const s = MAPPING_STATUS[status];
  return (
    <Badge
      variant={s.tone}
      className={cn('px-1.5 py-0 text-[10px] whitespace-nowrap', className)}
      title={grouping && status === 'GROUPING' ? `${s.hint} Grouping: ${grouping}` : s.hint}
    >
      {s.label}
    </Badge>
  );
}
