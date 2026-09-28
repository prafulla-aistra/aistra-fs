import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { PASSWORD_RULES_TEXT, passwordProblems, type UserDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { generateTemporaryPassword } from '@/lib/format';

export function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserDto;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [password, setPassword] = useState(generateTemporaryPassword);
  const problems = passwordProblems(password);
  const mutation = useMutation({
    mutationFn: () =>
      api.post<UserDto>(`/users/${user.id}/reset-password`, { temporaryPassword: password }),
    onSuccess: () =>
      onDone(
        `Password reset for ${user.name}. Give them the temporary password "${password}" — they must change it when they next sign in.`,
      ),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reset password for ${user.name}`}
      description="They will be signed out and must choose a new password at their next sign-in. A locked account is also unlocked."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={problems.length > 0 || mutation.isPending}
          >
            Reset password
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {mutation.error && <Alert>{errorMessage(mutation.error)}</Alert>}
        <Field
          label="Temporary password"
          htmlFor="reset-password"
          hint={PASSWORD_RULES_TEXT}
          error={problems.length > 0 ? `Password ${problems.join(', ')}.` : null}
        >
          <div className="flex gap-2">
            <Input
              id="reset-password"
              className="font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setPassword(generateTemporaryPassword())}
            >
              Generate
            </Button>
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
