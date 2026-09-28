import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import type { GroupStructureDto, GroupTreeNode } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { TbcBadge } from './common';

/** Read-only: the tree and the consolidation levels are derived from the entity master. */
export function GroupStructureTab() {
  const q = useQuery({
    queryKey: ['config', 'group-structure'],
    queryFn: () => api.get<GroupStructureDto>('/config/group-structure'),
  });
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <p className="text-sm text-muted-foreground">Loading group structure…</p>;
  const { tree, levels, issues } = q.data;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Group tree</CardTitle>
          <CardDescription>
            Functional currency and % held by the parent. Change it on the Entities tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {issues.length > 0 && (
            <Alert className="mb-3">
              The group structure is invalid, so it cannot be shown:
              <ul className="mt-1 list-disc pl-5">
                {issues.map((i) => (
                  <li key={i.code + (i.entityCode ?? '')}>{i.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          {tree && (
            <ul className="text-sm">
              <TreeNode node={tree} depth={0} />
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consolidation levels</CardTitle>
          <CardDescription>
            Derived automatically: one level for every entity with subsidiaries, deepest first. A
            level can start only when every level below it is finalised. Level currency defaults to
            the parent's reporting currency.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr>
                <Th>Level</Th>
                <Th>Name</Th>
                <Th>Currency</Th>
                <Th>Members</Th>
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.level} className="align-top">
                  <Td className="font-semibold">L{l.level}</Td>
                  <Td>{l.name}</Td>
                  <Td className="font-mono">{l.currency}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {l.members.map((m, i) => (
                        <Badge
                          key={m.code}
                          variant={i === 0 ? 'default' : 'outline'}
                          title={m.shortName}
                        >
                          {m.code}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function TreeNode({ node, depth }: { node: GroupTreeNode; depth: number }) {
  return (
    <li>
      <div className="flex flex-wrap items-center gap-2 py-1.5">
        {depth > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
        <span className="font-mono text-xs font-semibold">{node.code}</span>
        <span className="font-medium">{node.shortName}</span>
        <Badge variant="secondary" className="font-mono">
          {node.functionalCurrency}
        </Badge>
        {node.heldByParentPct && (
          <span className="text-xs text-muted-foreground">{node.heldByParentPct}% held</span>
        )}
        {node.toBeConfirmed && <TbcBadge />}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-1.5 border-l border-dashed pl-4">
          {node.children.map((c) => (
            <TreeNode key={c.code} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
