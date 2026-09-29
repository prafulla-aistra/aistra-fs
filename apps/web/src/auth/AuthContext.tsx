/* eslint-disable react-refresh/only-export-components -- the provider and its hooks belong together */
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PermissionCode, SessionResponse, SessionUser } from '@finance-close/shared';
import { api, refreshSession, setSession, subscribeSession } from '@/lib/api';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: SessionUser };

interface AuthContextValue {
  state: AuthState;
  /** True when the page could not reach the server on load. */
  serverUnreachable: boolean;
  login(email: string, password: string): Promise<SessionUser>;
  /** Demo mode only: sign in as a seeded demo account without a password. */
  demoLogin(email: string): Promise<SessionUser>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<SessionUser>;
  /** True if the user holds at least one of the codes. */
  hasAny(...codes: PermissionCode[]): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Renew the access token this many seconds before it expires. */
const REFRESH_MARGIN_SECONDS = 60;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [serverUnreachable, setServerUnreachable] = useState(false);
  const queryClient = useQueryClient();

  // Every session change (login, refresh, logout, server-side sign-out) lands here.
  useEffect(
    () =>
      subscribeSession((s: SessionResponse | null) => {
        if (s) {
          setState({ status: 'authenticated', user: s.user });
          setExpiresIn(s.expiresIn);
        } else {
          setState({ status: 'anonymous', user: null });
          setExpiresIn(null);
          queryClient.clear(); // never show one user's cached data to the next
        }
      }),
    [queryClient],
  );

  // On page load, the refresh cookie (if any) restores the session.
  useEffect(() => {
    refreshSession()
      .then((s) => {
        setServerUnreachable(false);
        if (!s) setState({ status: 'anonymous', user: null });
      })
      .catch(() => {
        // Could not ask the server: show the sign-in page with a clear message.
        setServerUnreachable(true);
        setState({ status: 'anonymous', user: null });
      });
  }, []);

  // Keep the 15-minute access token fresh while the app is open. If the server is briefly
  // unreachable (e.g. restarting), try again shortly instead of signing the user out.
  useEffect(() => {
    if (expiresIn === null) return;
    const ms = Math.max(5, expiresIn - REFRESH_MARGIN_SECONDS) * 1000;
    const timer = setTimeout(() => {
      refreshSession().catch(() => setExpiresIn(REFRESH_MARGIN_SECONDS + 15));
    }, ms);
    return () => clearTimeout(timer);
  }, [expiresIn, state]);

  const login = useCallback(async (email: string, password: string) => {
    const s = await api.post<SessionResponse>('/auth/login', { email, password });
    setServerUnreachable(false);
    setSession(s);
    return s.user;
  }, []);

  const demoLogin = useCallback(async (email: string) => {
    const s = await api.post<SessionResponse>('/auth/demo-login', { email });
    setServerUnreachable(false);
    setSession(s);
    return s.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSession(null);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const s = await api.post<SessionResponse>('/auth/change-password', {
      currentPassword,
      newPassword,
    });
    setSession(s);
    return s.user;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      serverUnreachable,
      login,
      demoLogin,
      logout,
      changePassword,
      hasAny: (...codes) =>
        state.status === 'authenticated' && codes.some((c) => state.user.permissions.includes(c)),
    }),
    [state, serverUnreachable, login, demoLogin, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For components rendered only inside the signed-in shell. */
export function useCurrentUser(): SessionUser {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('No signed-in user');
  return state.user;
}
