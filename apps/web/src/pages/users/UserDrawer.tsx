import { useMutation } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import {
  PASSWORD_RULES_TEXT,
  passwordProblems,
  type CreateUserRequest,
  type PermissionCode,
  type UpdateUserRequest,
  type UserDto,
} from '@finance-close/shared';
import { PERMISSION_LABELS } from '@/auth/navigation';
import { Button } from '@/components/ui/button';
import { Alert, Checkbox, Field, Input, Label, Select } from '@/components/ui/form';
import { Sheet } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { generateTemporaryPassword } from '@/lib/format';
import type { UserFormReference } from './UsersPage';

interface Props {
  mode: 'create' | 'edit';
  user?: UserDto;
  reference: UserFormReference;
  onClose: () => void;
  onSaved: (user: UserDto, message?: string) => void;
}

export function UserDrawer({ mode, user, reference, onClose, onSaved }: Props) {
  const isMaster = user?.isMaster ?? false;
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [tempPassword, setTempPassword] = useState(generateTemporaryPassword);
  const [templateCode, setTemplateCode] = useState<string | null>(user ? user.templateCode : null);
  const [permissions, setPermissions] = useState<Set<PermissionCode>>(
    new Set(user?.permissions ?? []),
  );
  const [allEntities, setAllEntities] = useState(user ? user.entityScope === null : true);
  const [entities, setEntities] = useState<Set<string>>(new Set(user?.entityScope ?? []));

  const groups = useMemo(() => {
    const byArea = new Map<string, typeof reference.permissions>();
    for (const p of reference.permissions) byArea.set(p.area, [...(byArea.get(p.area) ?? []), p]);
    return [...byArea.entries()];
  }, [reference]);

  const template = reference.templates.find((t) => t.code === templateCode);
  const adjusted =
    template !== undefined &&
    JSON.stringify([...permissions].sort()) !== JSON.stringify([...template.permissions].sort());

  const applyTemplate = (code: string) => {
    const t = reference.templates.find((x) => x.code === code);
    setTemplateCode(t ? t.code : null);
    if (t) setPermissions(new Set(t.permissions));
  };
  const toggle = <T,>(set: Set<T>, value: T, on: boolean): Set<T> => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  const pwProblems = mode === 'create' ? passwordProblems(tempPassword) : [];
  const scopeError = !allEntities && entities.size === 0 ? 'Choose at least one entity.' : null;
  const canSave = name.trim() && email.trim() && pwProblems.length === 0 && !scopeError;

  const mutation = useMutation({
    mutationFn: async (): Promise<UserDto> => {
      const access = {
        templateCode,
        permissions: [...permissions],
        entityScope: allEntities ? null : [...entities].sort(),
      };
      if (mode === 'create') {
        const body: CreateUserRequest = { name, email, temporaryPassword: tempPassword, ...access };
        return api.post<UserDto>('/users', body);
      }
      const body: UpdateUserRequest = isMaster ? { name, email } : { name, email, ...access };
      return api.patch<UserDto>(`/users/${user!.id}`, body);
    },
    onSuccess: (saved) =>
      onSaved(
        saved,
        mode === 'create'
          ? `${saved.name} was created. Give them their email and the temporary password "${tempPassword}" — they must change it when they first sign in.`
          : `Saved changes to ${saved.name}.`,
      ),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSave) mutation.mutate();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === 'create' ? 'Add user' : `Edit ${user!.name}`}
      description={
        mode === 'create'
          ? 'The user signs in with a temporary password and must change it the first time.'
          : undefined
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" disabled={!canSave || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : mode === 'create' ? 'Create user' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-6" noValidate>
        {mutation.error && <Alert>{errorMessage(mutation.error)}</Alert>}

        <section className="space-y-4">
          <Field label="Full name" htmlFor="u-name">
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Email" htmlFor="u-email" hint="Used to sign in. Must be unique.">
            <Input
              id="u-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {mode === 'create' && (
            <Field
              label="Temporary password"
              htmlFor="u-password"
              hint={PASSWORD_RULES_TEXT}
              error={pwProblems.length > 0 ? `Password ${pwProblems.join(', ')}.` : null}
            >
              <div className="flex gap-2">
                <Input
                  id="u-password"
                  className="font-mono"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTempPassword(generateTemporaryPassword())}
                >
                  Generate
                </Button>
              </div>
            </Field>
          )}
        </section>

        {isMaster ? (
          <Alert variant="info">
            The master admin always has every permission and access to all entities. These cannot be
            changed, and the account cannot be deactivated.
          </Alert>
        ) : (
          <>
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Permissions</h3>
              <Field
                label="Start from a template"
                htmlFor="u-template"
                hint={
                  adjusted
                    ? `Adjusted from the ${template!.name} template.`
                    : 'Choosing a template fills in the permissions below; you can then adjust them.'
                }
              >
                <Select
                  id="u-template"
                  value={templateCode ?? ''}
                  onChange={(e) => applyTemplate(e.target.value)}
                >
                  <option value="">No template (choose permissions manually)</option>
                  {reference.templates.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name} — {t.description}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="space-y-4 rounded-lg border p-4">
                {groups.map(([area, perms]) => (
                  <fieldset key={area} className="space-y-2">
                    <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {area}
                    </legend>
                    {perms.map((p) => (
                      <label
                        key={p.code}
                        className="flex cursor-pointer items-start gap-3 rounded-md p-1.5 hover:bg-muted/50"
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={permissions.has(p.code)}
                          onChange={(e) =>
                            setPermissions(toggle(permissions, p.code, e.target.checked))
                          }
                        />
                        <span className="text-sm">
                          <span className="font-medium">{PERMISSION_LABELS[p.code] ?? p.code}</span>
                          <span className="block text-xs text-muted-foreground">
                            {p.description} · <code className="font-mono">{p.code}</code>
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Entity access</h3>
              <div className="flex gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scope"
                    checked={allEntities}
                    onChange={() => setAllEntities(true)}
                  />
                  All entities
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="scope"
                    checked={!allEntities}
                    onChange={() => setAllEntities(false)}
                  />
                  Selected entities only
                </label>
              </div>
              {!allEntities && (
                <div className="space-y-1 rounded-lg border p-3">
                  {reference.entities.map((e) => (
                    <label
                      key={e.code}
                      className="flex cursor-pointer items-center gap-3 rounded-md p-1.5 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={entities.has(e.code)}
                        onChange={(ev) => setEntities(toggle(entities, e.code, ev.target.checked))}
                      />
                      <code className="w-8 font-mono text-xs">{e.code}</code>
                      {e.name}
                    </label>
                  ))}
                  {scopeError && <p className="px-1.5 text-xs text-destructive">{scopeError}</p>}
                </div>
              )}
              <Label className="block text-xs font-normal text-muted-foreground">
                Restricts which entities' data the user can work with in later steps.
              </Label>
            </section>
          </>
        )}
      </form>
    </Sheet>
  );
}
