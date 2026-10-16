import { Eye, EyeOff, Loader2, ShieldCheck, WifiOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { SERVER_UNREACHABLE_MESSAGE, type SessionUser } from '@finance-close/shared';
import { useAuth } from '@/auth/AuthContext';
import { BrandLockup } from '@/components/brand/BrandMark';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input } from '@/components/ui/form';
import { errorMessage, ServerUnreachableError } from '@/lib/api';
import { DemoAccounts } from './login/DemoAccounts';
import { Showcase } from './login/Showcase';

const TAGLINE =
  'Standalone and consolidated financial statements, from trial balance to final sign-off';

export function LoginPage() {
  const { state, login, demoLogin, serverUnreachable } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<{ text: string; unreachable: boolean } | null>(null);
  const [busy, setBusy] = useState<'form' | string | null>(null); // 'form' or a demo email
  const [slow, setSlow] = useState(false);

  // Only allow in-app redirects (never an external URL).
  const nextRaw = params.get('next');
  const next =
    nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/dashboard';

  // While the server is restarting the request is retried; after 3 s, say what is happening.
  useEffect(() => {
    if (!busy) return setSlow(false);
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [busy]);

  if (state.status === 'authenticated') {
    return <Navigate to={state.user.mustChangePassword ? '/change-password' : next} replace />;
  }

  const run = async (who: 'form' | string, attempt: () => Promise<SessionUser>) => {
    setError(null);
    setBusy(who);
    try {
      const user = await attempt();
      navigate(user.mustChangePassword ? '/change-password' : next, { replace: true });
    } catch (err) {
      setError({ text: errorMessage(err), unreachable: err instanceof ServerUnreachableError });
      if (who === 'form') setPassword('');
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (email && password) void run('form', () => login(email, password));
  };

  // The page-load check is shown only while no sign-in attempt is running (it retries itself).
  const showUnreachable = busy === null && (error?.unreachable || (serverUnreachable && !error));

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Brand panel: full showcase on large screens, slim header on small ones */}
      <aside className="relative flex flex-col overflow-hidden bg-sidebar px-6 py-5 text-white lg:w-[55%] lg:px-14 lg:py-12">
        <Backdrop />
        <div className="relative flex items-center justify-between">
          <BrandLockup />
        </div>
        <p className="relative mt-3 max-w-xl text-sm text-sidebar-muted lg:hidden">{TAGLINE}</p>
        <div className="relative hidden flex-1 flex-col justify-center py-10 lg:flex">
          <h1 className="max-w-xl text-4xl leading-tight font-semibold tracking-tight text-white">
            Finance Close
          </h1>
          <p className="mt-3 max-w-xl text-lg leading-relaxed text-sidebar-muted">{TAGLINE}</p>
          <div className="mt-10">
            <Showcase />
          </div>
        </div>
        <p className="relative hidden text-xs text-sidebar-muted lg:block">
          Aistra group · Ind AS 21 / IAS 21 translation · multi-level consolidation
        </p>
      </aside>

      {/* Sign-in */}
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:px-8 lg:items-center">
        <div className="w-full max-w-md space-y-8">
          <div className="rounded-2xl border bg-card p-7 shadow-sm sm:p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the email and password your administrator gave you.
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4" noValidate>
              {showUnreachable ? (
                <Alert className="flex items-start gap-2">
                  <WifiOff className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <strong className="font-semibold">{SERVER_UNREACHABLE_MESSAGE}</strong>
                    <span className="mt-0.5 block text-xs">
                      Start it with <code className="font-mono">npm run dev</code> and wait for
                      “Finance Close is ready”.
                    </span>
                  </span>
                </Alert>
              ) : (
                error && <Alert>{error.text}</Alert>
              )}

              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  className="h-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    className="h-10 pr-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={busy !== null || !email || !password}
              >
                {busy === 'form' ? (
                  <>
                    <Loader2 className="animate-spin" />
                    {slow ? 'Waiting for the server…' : 'Signing in…'}
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Forgot password? Contact your administrator.
              </p>
            </form>
          </div>

          <DemoAccounts
            busyEmail={busy !== 'form' ? busy : null}
            onPick={(e) => void run(e, () => demoLogin(e))}
          />

          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Every sign-in is recorded in the audit trail.
          </p>
        </div>
      </main>
    </div>
  );
}

/** Subtle ledger-grid and glow behind the brand panel. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div className="absolute -top-40 -right-32 size-[28rem] rounded-full bg-teal opacity-30 blur-3xl" />
      <div className="absolute -bottom-48 -left-24 size-[26rem] rounded-full bg-[#231E45] opacity-60 blur-3xl" />
    </div>
  );
}

/** Centred themed layout for the password screens. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="bg-sidebar px-6 py-4">
        <BrandLockup />
      </header>
      <div className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
