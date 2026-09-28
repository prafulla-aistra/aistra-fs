import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import type {
  EntityOptionDto,
  PermissionDto,
  PermissionTemplateDto,
  UserDto,
} from '@finance-close/shared';
import { useCurrentUser } from '@/auth/AuthContext';
import { PageHeader } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { UserDrawer } from './UserDrawer';

export interface UserFormReference {
  permissions: PermissionDto[];
  templates: PermissionTemplateDto[];
  entities: EntityOptionDto[];
}

export function UsersPage() {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserDto[]>('/users') });
  const reference = useQuery({
    queryKey: ['users', 'reference'],
    queryFn: async (): Promise<UserFormReference> => {
      const [permissions, templates, entities] = await Promise.all([
        api.get<PermissionDto[]>('/permissions'),
        api.get<PermissionTemplateDto[]>('/permission-templates'),
        api.get<EntityOptionDto[]>('/entities'),
      ]);
      return { permissions, templates, entities };
    },
    staleTime: 5 * 60_000,
  });

  const [drawer, setDrawer] = useState<{ mode: 'create' } | { mode: 'edit'; user: UserDto } | null>(
    null,
  );
  const [resetFor, setResetFor] = useState<UserDto | null>(null);
  const [statusFor, setStatusFor] = useState<UserDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  return (
    <>
      <PageHeader
        title="User management"
        description="Create users, set their permissions and entity access, and deactivate them when they leave. Users are never deleted."
        actions={
          <Button onClick={() => setDrawer({ mode: 'create' })} disabled={!reference.data}>
            <Plus /> Add user
          </Button>
        }
      />

      {notice && (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      )}
      {(users.error || reference.error) && (
        <Alert className="mb-4">{errorMessage(users.error ?? reference.error)}</Alert>
      )}

      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Template</Th>
            <Th>Status</Th>
            <Th>Last login</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {users.isPending && (
            <tr>
              <Td colSpan={6} className="text-muted-foreground">
                Loading users…
              </Td>
            </tr>
          )}
          {users.data?.map((u) => (
            <tr key={u.id} className="hover:bg-muted/30">
              <Td>
                <div className="font-medium">{u.name}</div>
                {u.isMaster && <div className="text-xs text-muted-foreground">Master admin</div>}
              </Td>
              <Td className="text-muted-foreground">{u.email}</Td>
              <Td>
                {u.templateLabel ?? <span className="text-muted-foreground">No permissions</span>}
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {u.status === 'ACTIVE' ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                  {u.lockedUntil && <Badge variant="destructive">Locked</Badge>}
                  {u.mustChangePassword && u.status === 'ACTIVE' && (
                    <Badge variant="outline">Temporary password</Badge>
                  )}
                </div>
              </Td>
              <Td className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(u.lastLoginAt)}
              </Td>
              <Td>
                <div className="flex justify-end gap-1">
                  {(!u.isMaster || me.isMaster) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDrawer({ mode: 'edit', user: u })}
                      disabled={!reference.data}
                    >
                      <Pencil /> Edit
                    </Button>
                  )}
                  {(!u.isMaster || me.isMaster) && (
                    <Button variant="ghost" size="sm" onClick={() => setResetFor(u)}>
                      <KeyRound /> Reset password
                    </Button>
                  )}
                  {!u.isMaster && u.id !== me.id && (
                    <Button variant="ghost" size="sm" onClick={() => setStatusFor(u)}>
                      {u.status === 'ACTIVE' ? (
                        <>
                          <UserX /> Deactivate
                        </>
                      ) : (
                        <>
                          <UserCheck /> Reactivate
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {drawer && reference.data && (
        <UserDrawer
          mode={drawer.mode}
          user={drawer.mode === 'edit' ? drawer.user : undefined}
          reference={reference.data}
          onClose={() => setDrawer(null)}
          onSaved={(saved, message) => {
            setDrawer(null);
            setNotice(message ?? `Saved ${saved.name}.`);
            void refresh();
          }}
        />
      )}
      {resetFor && (
        <ResetPasswordDialog
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={(message) => {
            setResetFor(null);
            setNotice(message);
            void refresh();
          }}
        />
      )}
      {statusFor && (
        <StatusDialog
          user={statusFor}
          onClose={() => setStatusFor(null)}
          onDone={(message) => {
            setStatusFor(null);
            setNotice(message);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function StatusDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserDto;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const deactivate = user.status === 'ACTIVE';
  const mutation = useMutation({
    mutationFn: () =>
      api.post<UserDto>(`/users/${user.id}/${deactivate ? 'deactivate' : 'reactivate'}`),
    onSuccess: () => onDone(`${user.name} has been ${deactivate ? 'deactivated' : 'reactivated'}.`),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={deactivate ? `Deactivate ${user.name}?` : `Reactivate ${user.name}?`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={deactivate ? 'destructive' : 'default'}
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {deactivate ? 'Deactivate' : 'Reactivate'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {mutation.error && <Alert>{errorMessage(mutation.error)}</Alert>}
        <p>
          {deactivate
            ? 'They will be signed out immediately and will not be able to sign in. Their history stays in the audit trail. You can reactivate them later.'
            : 'They will be able to sign in again with their existing password.'}
        </p>
      </div>
    </Dialog>
  );
}
