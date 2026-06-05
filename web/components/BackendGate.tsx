'use client';

import { useEffect, useState } from 'react';
import { initBackend } from '@/lib/supabase';

// Resolves which backend (mock/live) to use before rendering anything that
// queries Supabase. Fails safe to live inside initBackend(), so the splash is
// brief and the site always comes up.
export default function BackendGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    initBackend().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="h-2 w-2 animate-pulse rounded-full bg-novyx-gold" />
      </div>
    );
  }

  return <>{children}</>;
}
