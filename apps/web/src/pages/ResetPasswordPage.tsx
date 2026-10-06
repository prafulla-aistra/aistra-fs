import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PASSWORD_RULES_TEXT, passwordProblems } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { AuthLayout } from './LoginPage';

/** Opened from the emailed link: choose a new password, then sign in with it. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const problems = next ? passwordProblems(next) : [];
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = token && next && confirm && problems.length === 0 && !mismatch && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/password-reset/confirm', { token, newPassword: next });
      setDone(true);
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
          <CardTitle className="text-xl">Choose a new password</CardTitle>
          <CardDescription>
            The link from your email works once. Afterwards, sign in with the new password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <Alert variant="success">Your password has been changed.</Alert>
              <Button asChild className="w-full">
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          ) : !token ? (
            <Alert>
              This page needs the link from your email. Ask for a new one from your profile menu.
            </Alert>
          ) : (
            <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
              {error && <Alert>{error}</Alert>}
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
                  autoFocus
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
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
