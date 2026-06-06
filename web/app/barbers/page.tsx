'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getCustomer } from '@/lib/customer';
import { useActiveEntryRedirect } from '@/lib/active-entry';
import type { BarberOnShift } from '@shared/types';

function statusFor(waiting: number) {
  if (waiting === 0) return { dot: 'bg-novyx-ok', label: 'Available', tone: 'text-novyx-ok' };
  if (waiting <= 2) return { dot: 'bg-novyx-warn', label: `${waiting} ahead · short wait`, tone: 'text-novyx-muted' };
  return { dot: 'bg-novyx-danger', label: `${waiting} ahead · long wait`, tone: 'text-novyx-muted' };
}

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'breaks' }, load)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [checking]);

  if (checking) {
    return <main className="pt-8 text-center text-novyx-muted">Checking…</main>;
  }

  return (
    <main className="space-y-5 pt-4">
      <div className="flex gap-1.5">
        <span className="h-0.5 w-6 rounded-full bg-novyx-gold" />
        <span className="h-0.5 w-6 rounded-full bg-novyx-gold" />
        <span className="h-0.5 w-6 rounded-full bg-novyx-border" />
      </div>

      <header className="space-y-1">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-novyx-gold">— NOVYX —</p>
        <h1 className="font-serif text-3xl italic leading-tight text-novyx-cream">
          Choose your barber
        </h1>
        <p className="text-sm italic text-novyx-muted">Tap a name to pick your service.</p>
      </header>

      {error && (
        <p className="rounded-sm border border-novyx-danger/40 bg-novyx-danger/10 px-3 py-2 text-sm text-novyx-danger">
          {error}
        </p>
      )}

      {barbers === null && !error && <p className="text-novyx-muted">Loading…</p>}

      {barbers && barbers.length === 0 && (
        <div className="rounded-sm border border-novyx-border bg-novyx-surface p-6 text-center">
          <p className="font-medium text-novyx-cream">No barbers on shift right now.</p>
          <p className="mt-1 text-sm italic text-novyx-muted">This page updates live — hang tight.</p>
        </div>
      )}

      {barbers && barbers.length > 0 && (
        <ul className="space-y-2.5">
          {barbers.map((b, i) => {
            const s = statusFor(b.waiting_count);
            const isFree = b.waiting_count === 0;
            return (
              <li key={b.shift_id}>
                <Link
                  href={`/barbers/${b.shift_id}`}
                  className={`flex items-center rounded-sm border bg-novyx-surface px-4 py-3.5 hover:border-novyx-gold ${
                    isFree ? 'border-novyx-gold' : 'border-novyx-border'
                  }`}
                >
                  <span className="w-7 text-[11px] font-bold tracking-wider text-novyx-gold">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1 space-y-0.5">
                    <span className="block font-serif text-xl italic text-novyx-cream">
                      {b.staff_name}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      <span className={`text-[11px] ${isFree ? 'font-semibold text-novyx-gold' : s.tone}`}>
                        {isFree ? 'Free now' : s.label}
                      </span>
                    </span>
                  </span>
                  <span className="text-lg text-novyx-gold">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-1.5 pt-2">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-novyx-ok" />
        <span className="text-[10px] italic text-novyx-subtle">Updates live</span>
      </div>
    </main>
  );
}
