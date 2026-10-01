import { createContext } from 'react';
import type { CatalogItemDto } from '@finance-close/shared';

/** The catalog of live figures (values in the selected currency and units). */
export const CatalogContext = createContext<{ catalog: CatalogItemDto[]; indian: boolean }>({
  catalog: [],
  indian: false,
});
