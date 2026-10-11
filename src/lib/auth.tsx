import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase, errorMessage } from './supabase';

export type Membership =
  | { status: 'active'; role: 'owner' | 'student'; email: string; display_name: string | null }
  | { status: 'pending'; reason: string; email?: string }
  | { status: 'inactive'; email?: string };

type AuthState = {
  loading: boolean;
  session: Session | null;
  membership: Membership | null;
  error: string | null;
  isOwner: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [error, setError] = useState<string | null>(null);
  const claimRevision = useRef(0);
  const currentSession = useRef<Session | null>(null);

  const claim = useCallback(async (s: Session | null) => {
    const revision = ++claimRevision.current;
    setLoading(true);
    setError(null);
    if (!s) { setMembership(null); setLoading(false); return; }
    try {
      // Keep Auth callbacks quick and run client requests after the event returns.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (revision !== claimRevision.current) return;
      // Identity comes from verified auth.users, never from client role fields.
      const { data, error } = await supabase.rpc('claim_membership');
      if (revision !== claimRevision.current) return;
      if (error) throw error;
      setMembership(data as Membership);
    } catch (e) {
      if (revision !== claimRevision.current) return;
      setError(errorMessage(e));
      setMembership(null);
    } finally {
      if (revision === claimRevision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    let alive = true;
    const initialRevision = claimRevision.current;
    const acceptSession = (s: Session | null) => {
      if (currentSession.current?.user.id !== s?.user.id) setMembership(null);
      currentSession.current = s;
      setSession(s);
      void claim(s);
    };
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive || claimRevision.current !== initialRevision) return;
      if (error) throw error;
      acceptSession(data.session);
    }).catch((e) => {
      if (!alive || claimRevision.current !== initialRevision) return;
      setError(errorMessage(e));
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      if (!alive) return;
      if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'SIGNED_OUT'
        || currentSession.current?.user.id !== s?.user.id) acceptSession(s);
      else { currentSession.current = s; setSession(s); }
    });
    return () => { alive = false; ++claimRevision.current; sub.subscription.unsubscribe(); };
  }, [claim]);

  const value: AuthState = {
    loading, session, membership, error,
    isOwner: membership?.status === 'active' && membership.role === 'owner',
    refresh: async () => { await claim(currentSession.current); },
    signOut: async () => {
      const previousSession = currentSession.current;
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        if (currentSession.current === previousSession) {
          currentSession.current = null; setSession(null); await claim(null);
        }
      } catch (e) {
        if (currentSession.current === previousSession) setError(errorMessage(e));
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/`, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw new Error(errorMessage(error));
}
