import type { MappingStatusCode } from '@finance-close/shared';

/** Statuses the finance team should act on (everything but the client groupings / system). */
export const needsAttention = (s: MappingStatusCode) => s !== 'GROUPING' && s !== 'SYSTEM';
