// Track the customer's currently-active queue entry in localStorage so they
// can't accidentally queue twice by hitting Back or rescanning the QR code.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from './supabase';

const ACTIVE_ENTRY_KEY = 'barbershop.activeEntry';

export function setActiveEntryId(id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_ENTRY_KEY, id);
}

export function getActiveEntryId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_ENTRY_KEY);
}

export function clearActiveEntryId(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACTIVE_ENTRY_KEY);
}

/**
 * On mount: if the customer has a stored entry that's still waiting or
 * in_progress, redirect them to /queue/[entryId]. If the entry no longer
 * exists or is done/cancelled, clear the stored id and let the page render.
 *
 * Returns `checking` so the page can show a loading state until we know the
 * customer isn't being redirected (avoids a flash of the form).
 */
export function useActiveEntryRedirect(): { checking: boolean } {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const entryId = getActiveEntryId();
    if (!entryId) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('queue_entries')
        .select('id, status')
        .eq('id', entryId)
        .maybeSingle();
      if (cancelled) return;

      if (error || !data) {
        clearActiveEntryId();
        setChecking(false);
        return;
      }
      if (data.status === 'waiting' || data.status === 'in_progress') {
        router.replace(`/queue/${entryId}`);
      } else {
        clearActiveEntryId();
        setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return { checking };
}
