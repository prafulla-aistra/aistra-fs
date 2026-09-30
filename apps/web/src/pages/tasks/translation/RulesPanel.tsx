import { ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/** Plain-language summary of how the translation works (collapsible). */
export function RulesPanel() {
  return (
    <Card>
      <CardContent>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
            How the translation works
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Assets and liabilities use the closing rate; income and expenses use the average rate.
            </li>
            <li>
              Share capital and securities premium use the historical rate from the entity master.
              If there is none, the opening rate is used and a warning is shown.
            </li>
            <li>Other reserves use the opening rate.</li>
            <li>
              Retained earnings are rolled forward: last period’s finalised translated retained
              earnings plus its translated profit — when last period is finalised in this currency
              and the roll-forward check on the comparatives step passed. Otherwise the opening rate
              is used, with a warning.
            </li>
            <li>An account can override its FSLI’s rate; those lines carry an “override” badge.</li>
            <li>
              Rates are cross rates from the USD rate master (B per USD ÷ A per USD), used at full
              precision. Each line is rounded to 2 decimals, half away from zero.
            </li>
            <li>
              Profit for the period is the total of the translated income and expense lines. The
              FCTR is the balancing figure that makes the translated trial balance net to exactly
              0.00; it is part of equity.
            </li>
            <li>
              If an opening, closing or average rate is missing, that currency is not translated.
            </li>
            <li>
              Figures are recalculated whenever this page opens, until the entity is finalised.
            </li>
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
