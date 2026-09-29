import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ConsolidationIllustration,
  ControlsIllustration,
  StatutoryIllustration,
} from './illustrations';

describe('sign-in illustrations', () => {
  it.each([
    [
      'Statutory FS preparation',
      StatutoryIllustration,
      ['Trial balance', 'Balance sheet', 'Profit &amp; loss', 'Notes', '₹'],
    ],
    [
      'Consolidation',
      ConsolidationIllustration,
      ['VS', 'UC', 'IN', 'US', 'Eliminations', 'SGD', 'AED', '£', '$'],
    ],
    [
      'Controls and sign-off',
      ControlsIllustration,
      ['Close checklist', 'Maker', 'Checker', 'APPROVED', 'Audit trail'],
    ],
  ] as const)('%s renders as self-contained, decorative SVG', (_name, Illustration, texts) => {
    const html = renderToStaticMarkup(<Illustration />);
    expect(html.startsWith('<svg')).toBe(true);
    expect(html).toContain('aria-hidden="true"');
    for (const t of texts) expect(html).toContain(t);
    // No external images or links (licensing, offline use).
    expect(html).not.toMatch(/<image|href=|url\(http/);
  });
});
