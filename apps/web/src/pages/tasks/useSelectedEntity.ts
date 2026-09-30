import { useEffect, useState } from 'react';
import type { EntityTab } from './EntityTabs';

const storageKey = (taskId: string) => `fc:workspace-entity:${taskId}`;
function remembered(taskId: string): string | null {
  try {
    return localStorage.getItem(storageKey(taskId));
  } catch {
    return null;
  }
}

/**
 * The selected entity of a task workspace, remembered per task (shared by the steps).
 * Falls back to the first entity with a validated TB.
 */
export function useSelectedEntity(taskId: string, entities: readonly EntityTab[]) {
  const [selected, setSelected] = useState<string | null>(() => remembered(taskId));
  useEffect(() => {
    if (entities.length > 0 && !entities.some((e) => e.code === selected)) {
      setSelected((entities.find((e) => e.hasValidatedTb) ?? entities[0])!.code);
    }
  }, [entities, selected]);
  const choose = (code: string) => {
    setSelected(code);
    try {
      localStorage.setItem(storageKey(taskId), code);
    } catch {
      /* private window: not remembered */
    }
  };
  return [selected, choose] as const;
}
