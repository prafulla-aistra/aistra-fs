import { createContext, useContext } from 'react';

/**
 * Where a workspace's notes / review endpoints live: an SFS task entity
 * (/tasks/:id/entities/:code) or a CFS level (/tasks/:id/cfs/levels/:n). The same components
 * serve both (page 10 reuses the SFS notes framework and review pack).
 */
export const ApiBaseContext = createContext<string | null>(null);

export function useApiBase(taskId: string, entityCode: string): string {
  return useContext(ApiBaseContext) ?? `/tasks/${taskId}/entities/${entityCode}`;
}
