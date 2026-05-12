'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getCustomer } from '@/lib/customer';
import { useActiveEntryRedirect } from '@/lib/active-entry';
import type { BarberOnShift } from '@shared/types';

export default function BarbersPage() {
  const router = useRouter();
  const { checking } = useActiveEntryRedirect();
  const [barbers, setBarbers] = useState<BarberOnShift[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!checking && !getCustomer()) {
      router.replace('/');
    }
  }, [router, checking]);

  useEffect(() => {
    if (checking) return;
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase
        .from('barbers_on_shift')
        .select('*')
        .order('staff_name');
      if (cancelled) return;
      if (error) setError(error.message);
      else setBarbers(data ?? []);
    }

    load();

    const channel = supabase
      .channel(`barbers-on-shift-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries' }, load)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [checking]);

  if (checking) {
    return <main className="pt-8 text-center text-stone-500">Checking…</main>;
  }

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Pick a barber</h1>
        <p className="mt-1 text-sm text-stone-600">
          Only barbers on shift right now are shown.
        </p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {barbers === null && !error && (
        <p className="text-stone-500">Loading…</p>
      )}

      {barbers && barbers.length === 0 && (
        <div className="rounded-lg bg-stone-100 p-6 text-center">
          <p className="font-medium text-stone-700">No barbers on shift right now.</p>
          <p className="mt-1 text-sm text-stone-500">
            This page updates live — hang tight.
          </p>
        </div>
      )}

      {barbers && barbers.length > 0 && (
        <ul className="space-y-3">
          {barbers.map((b) => (
            <li key={b.shift_id}>
              <Link
                href={`/barbers/${b.shift_id}`}
                className="flex items-center justify-between rounded-lg border border-stone-200 bg-white p-4 hover:border-stone-400"
              >
                <span className="font-medium">{b.staff_name}</span>
                <span className="text-sm text-stone-600">
                  {b.waiting_count === 0
                    ? 'No one waiting'
                    : `${b.waiting_count} ahead of you`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
