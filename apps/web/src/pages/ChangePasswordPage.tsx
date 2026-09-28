import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { PASSWORD_RULES_TEXT, passwordProblems } from '@finance-close/shared';
import { useAuth, useCurrentUser } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Field, Input } from '@/components/ui/form';
import { errorMessage } from '@/lib/api';
import { AuthLayout } from './LoginPage';

/** Forced after signing in with a temporary password; also usable voluntarily. */
export function ChangePasswordPage() {
  const user = useCurrentUser();
  const { changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problems = next ? passwordProblems(next) : [];
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = current && next && confirm && problems.length === 0 && !mismatch && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await changePassword(current, next);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {user.mustChangePassword ? 'Choose a new password' : 'Change password'}
          </CardTitle>
          <CardDescription>
            {user.mustChangePassword
              ? `Welcome, ${user.name}. You signed in with a temporary password — choose your own to continue.`
              : 'Enter your current password and a new one.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
            {error && <Alert>{error}</Alert>}
            <Field
              label={user.mustChangePassword ? 'Temporary password' : 'Current password'}
              htmlFor="current"
            >
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field
              label="New password"
              htmlFor="new"
              hint={PASSWORD_RULES_TEXT}
              error={problems.length > 0 ? `Password ${problems.join(', ')}.` : null}
            >
              <Input
                id="new"
                type="password"
                autoComplete="new-password"
                aria-invalid={problems.length > 0}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <Field
              label="Confirm new password"
              htmlFor="confirm"
              error={mismatch ? 'The passwords do not match.' : null}
            >
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                aria-invalid={mismatch}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {busy ? 'Saving…' : 'Save new password'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
            >
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
