import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
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

  const claim = useCallback(async (s: Session | null) => {
    setError(null);
    if (!s) { setMembership(null); return; }
    // Server-side claim: identity comes from auth.users (verified Google email), never from client fields
    const { data, error } = await supabase.rpc('claim_membership');
    if (error) { setError(errorMessage(error)); setMembership(null); return; }
    setMembership(data as Membership);
  }, []);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await claim(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      setSession(s);
      if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') { setLoading(true); claim(s).finally(() => setLoading(false)); }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [claim]);

  const value: AuthState = {
    loading, session, membership, error,
    isOwner: membership?.status === 'active' && membership.role === 'owner',
    refresh: async () => { setLoading(true); await claim(session); setLoading(false); },
    signOut: async () => { await supabase.auth.signOut(); setMembership(null); setSession(null); },
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
