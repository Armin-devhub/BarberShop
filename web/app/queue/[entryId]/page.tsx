'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { clearActiveEntryId } from '@/lib/active-entry';
import { formatRM, type PublicQueueEntry } from '@shared/types';

interface QueueRow {
  id: string;
  queue_number: number;
  status: PublicQueueEntry['status'];
  customer_name: string;
}

interface MyEntry extends PublicQueueEntry {
  services?: { name: string; duration_minutes: number } | null;
  staff?: { name: string } | null;
}

export default function QueuePage() {
  const router = useRouter();
  const { entryId } = useParams<{ entryId: string }>();
  const [me, setMe] = useState<MyEntry | null>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    if (!confirm('Cancel your spot in the queue?')) return;
    setCancelling(true);
    const { error } = await supabase.rpc('cancel_queue_entry', { p_entry_id: entryId });
    setCancelling(false);
    if (error) {
      setError(error.message);
      return;
    }
    clearActiveEntryId();
    router.replace('/barbers');
  }

  function handleBookAgain() {
    clearActiveEntryId();
    router.push('/barbers');
  }

  const load = useCallback(async () => {
    const { data: myEntry, error: myErr } = await supabase
      .from('queue_entries')
      .select(
        `id, staff_id, shift_id, queue_number, queue_date, status, service_id,
         customer_name, base_price_sen, final_price_sen, price_adjustment_sen,
         created_at, started_at, completed_at,
         services:service_id ( name, duration_minutes ),
         staff:staff_id ( name )`
      )
      .eq('id', entryId)
      .single<MyEntry>();

    if (myErr) {
      setError(myErr.message);
      return;
    }
    setMe(myEntry);

    const { data: queueRows } = await supabase
      .from('queue_entries')
      .select('id, queue_number, status, customer_name')
      .eq('staff_id', myEntry.staff_id)
      .eq('queue_date', myEntry.queue_date)
      .in('status', ['waiting', 'in_progress'])
      .order('queue_number', { ascending: true });

    setQueue((queueRows as QueueRow[] | null) ?? []);

    if (myEntry.status === 'done' || myEntry.status === 'cancelled') {
      clearActiveEntryId();
    }
  }, [entryId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`queue-watch-${entryId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queue_entries' },
        load
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [entryId, load]);

  if (error) {
    return (
      <main className="space-y-4 pt-8 text-center">
        <p className="text-novyx-danger">{error}</p>
        <Link href="/" className="text-sm italic text-novyx-gold underline">
          Start over
        </Link>
      </main>
    );
  }

  if (!me) {
    return <main className="pt-8 text-novyx-muted">Loading…</main>;
  }

  const inProgress = queue.find((r) => r.status === 'in_progress');
  const aheadOfMe =
    queue.filter((r) => r.status === 'waiting' && r.queue_number < me.queue_number).length +
    (inProgress && inProgress.id !== me.id ? 1 : 0);
  const isMyTurn = me.status === 'in_progress';
  const isDone = me.status === 'done';
  const isCancelled = me.status === 'cancelled';
  const livePosition = isMyTurn ? 1 : aheadOfMe + 1;
  const estMin = aheadOfMe * (me.services?.duration_minutes ?? 30);

  // Price breakdown: service + barber's adjustment = subtotal, then discount.
  const priceAdjustment = me.price_adjustment_sen ?? 0;
  const subtotal = me.base_price_sen + priceAdjustment;
  const discountSen = subtotal - me.final_price_sen;

  return (
    <main className="space-y-5 pt-2">
      {/* Live indicator */}
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-novyx-ok" />
        <span className="text-[10px] font-bold tracking-[0.2em] text-novyx-ok">
          LIVE — UPDATES AUTOMATICALLY
        </span>
      </div>

      {/* Hero position */}
      <header className="space-y-1">
        <p className="text-[10px] font-bold tracking-[0.25em] text-novyx-gold">
          —  {isDone || isCancelled ? 'YOUR QUEUE' : 'YOU ARE NO.'}  —
        </p>
        <p className="font-serif text-8xl italic tabular-nums text-novyx-cream">
          {isDone || isCancelled ? '—' : String(livePosition).padStart(2, '0')}
        </p>
        <p className="text-sm italic text-novyx-muted">
          with <span className="text-novyx-cream">{me.staff?.name ?? '—'}</span>
          {!isDone && !isCancelled && !isMyTurn && estMin > 0 && (
            <> · ~{estMin} min wait</>
          )}
        </p>
      </header>

      {/* Status box */}
      <div className="rounded-sm border border-novyx-border bg-novyx-surface p-4">
        {isDone && (
          <p className="text-base font-semibold text-novyx-ok">
            Service complete. Thanks for visiting!
          </p>
        )}
        {isCancelled && (
          <p className="text-base font-semibold text-novyx-danger">This entry was cancelled.</p>
        )}
        {isMyTurn && (
          <>
            <p className="text-base font-semibold text-novyx-cream">It's your turn.</p>
            <p className="mt-0.5 text-[11px] italic text-novyx-muted">Head to the chair.</p>
          </>
        )}
        {!isMyTurn && !isDone && !isCancelled && (
          <>
            <p className="text-base font-semibold text-novyx-cream">
              {aheadOfMe === 0
                ? "You're up next."
                : `${aheadOfMe} ${aheadOfMe === 1 ? 'person' : 'people'} ahead of you`}
            </p>
            <p className="mt-0.5 text-[11px] italic text-novyx-muted">
              We'll text when you're next.
            </p>
          </>
        )}
      </div>

      {(isDone || isCancelled) && (
        <button
          type="button"
          onClick={handleBookAgain}
          className="block w-full rounded-sm bg-novyx-gold px-4 py-3.5 text-xs font-bold tracking-[0.2em] text-novyx-bg hover:bg-novyx-goldHi"
        >
          BOOK ANOTHER CUT
        </button>
      )}

      {/* Booking summary */}
      <section className="space-y-2">
        <p className="text-[10px] font-bold tracking-[0.2em] text-novyx-gold">YOUR BOOKING</p>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="font-serif italic text-novyx-cream">{me.services?.name ?? 'Service'}</span>
            <span className="text-novyx-cream">{formatRM(me.base_price_sen)}</span>
          </div>
          {priceAdjustment > 0 && (
            <div className="flex justify-between">
              <span className="text-novyx-subtle">Add-on</span>
              <span className="text-novyx-cream">+{formatRM(priceAdjustment)}</span>
            </div>
          )}
          {priceAdjustment < 0 && (
            <div className="flex justify-between">
              <span className="text-novyx-subtle">Reduction</span>
              <span className="text-novyx-cream">−{formatRM(Math.abs(priceAdjustment))}</span>
            </div>
          )}
          {discountSen > 0 && (
            <div className="flex justify-between text-novyx-ok">
              <span>Discount</span>
              <span>−{formatRM(discountSen)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-novyx-border pt-1.5">
            <span className="text-novyx-subtle">Total</span>
            <span className="font-semibold text-novyx-gold">{formatRM(me.final_price_sen)}</span>
          </div>
        </div>
      </section>

      {me.status === 'waiting' && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="block w-full rounded-sm border border-novyx-subtle px-4 py-3 text-xs font-bold tracking-[0.2em] text-novyx-muted hover:border-novyx-muted disabled:opacity-50"
        >
          {cancelling ? 'CANCELLING…' : 'CANCEL MY SPOT'}
        </button>
      )}

      {queue.length > 0 && (
        <section className="space-y-1.5">
          <p className="text-[10px] font-bold tracking-[0.2em] text-novyx-gold">TODAY'S QUEUE</p>
          <ul className="space-y-1">
            {queue.map((r, i) => (
              <li
                key={r.id}
                className={`flex items-center justify-between rounded-sm px-3 py-2 text-sm ${
                  r.id === me.id
                    ? 'bg-novyx-gold text-novyx-bg'
                    : r.status === 'in_progress'
                      ? 'border border-novyx-ok bg-novyx-surface text-novyx-ok'
                      : 'border border-novyx-border bg-novyx-surface text-novyx-muted'
                }`}
              >
                <span className="tabular-nums font-semibold">#{i + 1}</span>
                <span className="font-serif italic">
                  {r.id === me.id ? 'You' : r.customer_name}
                  {r.status === 'in_progress' && (
                    <span className="ml-2 text-[10px] font-sans not-italic tracking-wider">
                      (IN CHAIR)
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="pt-2 text-center text-[10px] italic text-novyx-subtle">
        Keep this page open.
      </p>
    </main>
  );
}
