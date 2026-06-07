import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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

  // Show the full-screen spinner only on the FIRST auth resolution. Later auth
  // events (notably the token refresh Supabase fires when the browser tab
  // regains focus) must update state silently — otherwise flipping `loading`
  // unmounts the admin <Slot/> and the page snaps back to the Dashboard.
  const didInitialLoad = useRef(false);
  // The staff row we've already loaded; lets a same-user token refresh skip the
  // refetch (and the UI flash) entirely.
  const loadedUserId = useRef<string | null>(null);

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

  async function applySession(
    currentSession: Session | null,
    { showLoading }: { showLoading: boolean }
  ) {
    setSession(currentSession);

    if (!currentSession) {
      loadedUserId.current = null;
      setStaff(null);
      setLoading(false);
      return;
    }

    // Same user we've already resolved (e.g. a tab-focus token refresh): keep
    // the refreshed token but don't refetch staff or touch `loading`, so the
    // current admin page stays exactly where it is.
    if (loadedUserId.current === currentSession.user.id) {
      setLoading(false);
      return;
    }

    if (showLoading) setLoading(true);
    const result = await loadStaff(currentSession.user.id);
    loadedUserId.current = currentSession.user.id;
    setStaff(result);
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session, { showLoading: !didInitialLoad.current });
      didInitialLoad.current = true;
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // After the first resolution, never block the UI again — background
      // refreshes update state silently instead of unmounting the page.
      applySession(newSession, { showLoading: !didInitialLoad.current });
      didInitialLoad.current = true;
    });

    return () => {
      subscription.unsubscribe();
    };
    // Re-run on backend swap so we re-subscribe to the new client's auth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendVersion]);

  // Force a staff refetch (e.g. after editing the signed-in profile). Silent —
  // never toggles `loading`, so it won't disturb the current page.
  async function reloadStaff() {
    if (!session) return;
    const result = await loadStaff(session.user.id);
    loadedUserId.current = session.user.id;
    setStaff(result);
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
