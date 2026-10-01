import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import type { QueryMarkerDto, QueryTargetType } from '@finance-close/shared';
import { api } from '@/lib/api';

/** Keys ("NOTE:<id>", "LINE:BS:<key>", "ACCOUNT:<code>") with a review query not yet closed. */
export function useQueryMarkers(taskId: string, entityCode: string) {
  const q = useQuery({
    queryKey: ['review-markers', taskId, entityCode],
    queryFn: () =>
      api.get<QueryMarkerDto[]>(`/tasks/${taskId}/entities/${entityCode}/review/markers`),
    staleTime: 30_000,
  });
  const counts = new Map<string, number>();
  for (const m of q.data ?? []) {
    const k = `${m.targetType}:${m.targetKey ?? ''}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return (type: QueryTargetType, key: string) => counts.get(`${type}:${key}`) ?? 0;
}

/** Links from notifications carry ?entity=XX: select it once. */
export function useEntityFromUrl(
  entities: readonly { code: string }[],
  choose: (c: string) => void,
) {
  const [search] = useSearchParams();
  const wanted = search.get('entity');
  useEffect(() => {
    if (wanted && entities.some((e) => e.code === wanted)) choose(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, entities.length]);
}
