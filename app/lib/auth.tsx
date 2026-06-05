import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, onBackendChange } from './supabase';
import type { Staff } from './types';

interface AuthContextValue {
  session: Session | null;
  staff: Staff | null;
  loading: boolean;
  reloadStaff: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped when the backend (mock/live) is swapped, so the auth subscription
  // below re-binds to the new backend's client.
  const [backendVersion, setBackendVersion] = useState(0);

  useEffect(() => onBackendChange(() => setBackendVersion((v) => v + 1)), []);

  async function loadStaff(authUserId: string): Promise<Staff | null> {
    // Try direct lookup first.
    const { data: existing } = await supabase
      .from('staff')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (existing) return existing as Staff;

    // First sign-in: try to claim a staff row by email match.
    const { data: claimed } = await supabase
      .rpc('claim_staff_account')
      .single<Staff>();
    return claimed ?? null;
  }

  async function refresh(currentSession: Session | null) {
    setSession(currentSession);
    if (!currentSession) {
      setStaff(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await loadStaff(currentSession.user.id);
    setStaff(result);
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      refresh(data.session);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      refresh(newSession);
    });

    return () => {
      subscription.unsubscribe();
    };
    // Re-run on backend swap so we re-subscribe to the new client's auth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendVersion]);

  async function reloadStaff() {
    if (session) await refresh(session);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, staff, loading, reloadStaff, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
