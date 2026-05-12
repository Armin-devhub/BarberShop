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
         customer_name, base_price_sen, final_price_sen,
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

    // Once the entry reaches a terminal state, free up localStorage so the
    // customer can book again from the landing page.
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
        <p className="text-red-600">{error}</p>
        <Link href="/" className="text-sm underline">
          Start over
        </Link>
      </main>
    );
  }

  if (!me) {
    return <main className="pt-8 text-stone-500">Loading…</main>;
  }

  const inProgress = queue.find((r) => r.status === 'in_progress');
  const aheadOfMe =
    queue.filter((r) => r.status === 'waiting' && r.queue_number < me.queue_number)
      .length + (inProgress && inProgress.id !== me.id ? 1 : 0);
  const isMyTurn = me.status === 'in_progress';
  const isDone = me.status === 'done';
  const isCancelled = me.status === 'cancelled';
  // Live position in line: 1 = up next / in chair.
  const livePosition = isMyTurn ? 1 : aheadOfMe + 1;

  return (
    <main className="space-y-6 pt-4">
      <header className="text-center">
        <p className="text-sm uppercase tracking-wider text-stone-500">
          {isDone || isCancelled ? 'Your queue' : 'Your position'}
        </p>
        <p className="mt-1 text-7xl font-bold tabular-nums">
          {isDone || isCancelled ? '—' : `#${livePosition}`}
        </p>
        <p className="mt-2 text-stone-600">
          for <span className="font-medium">{me.staff?.name ?? '—'}</span>
        </p>
      </header>

      <div className="rounded-lg bg-stone-100 p-4 text-center">
        {isDone && (
          <p className="font-medium text-emerald-700">Service complete. Thanks for visiting!</p>
        )}
        {isCancelled && (
          <p className="font-medium text-red-700">This entry was cancelled.</p>
        )}
        {isMyTurn && (
          <p className="text-lg font-semibold text-stone-900">
            It's your turn — head to the chair.
          </p>
        )}
        {!isMyTurn && !isDone && !isCancelled && (
          <p className="text-lg">
            {aheadOfMe === 0 ? (
              <span className="font-semibold">You're up next.</span>
            ) : (
              <>
                <span className="font-semibold">{aheadOfMe}</span>{' '}
                {aheadOfMe === 1 ? 'person' : 'people'} ahead of you
              </>
            )}
          </p>
        )}
      </div>

      {(isDone || isCancelled) && (
        <button
          type="button"
          onClick={handleBookAgain}
          className="w-full rounded-lg bg-stone-900 px-4 py-3 font-medium text-white hover:bg-stone-800"
        >
          Book another cut
        </button>
      )}

      {me.status === 'waiting' && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
        >
          {cancelling ? 'Cancelling…' : 'Cancel my spot'}
        </button>
      )}

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-medium text-stone-500">Booking</h2>
        <div className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-stone-600">Service</span>
            <span className="font-medium">{me.services?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-600">Estimated wait</span>
            <span className="font-medium">
              {aheadOfMe === 0 || !me.services
                ? '—'
                : `~${aheadOfMe * (me.services.duration_minutes ?? 30)} min`}
            </span>
          </div>
          <div className="flex justify-between border-t border-stone-100 pt-2">
            <span className="text-stone-600">Total</span>
            <span className="font-semibold">{formatRM(me.final_price_sen)}</span>
          </div>
          {me.base_price_sen !== me.final_price_sen && (
            <div className="text-right text-xs text-emerald-700">
              Discount applied (was {formatRM(me.base_price_sen)})
            </div>
          )}
        </div>
      </section>

      {queue.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-stone-500">Today's queue</h2>
          <ul className="space-y-1">
            {queue.map((r, i) => (
              <li
                key={r.id}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                  r.id === me.id
                    ? 'bg-stone-900 text-white'
                    : r.status === 'in_progress'
                      ? 'bg-emerald-50 text-emerald-900'
                      : 'bg-stone-50 text-stone-700'
                }`}
              >
                <span className="tabular-nums">#{i + 1}</span>
                <span>
                  {r.id === me.id ? 'You' : r.customer_name}
                  {r.status === 'in_progress' && (
                    <span className="ml-2 text-xs">(in chair)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="pt-4 text-center text-xs text-stone-400">
        This page updates automatically. Keep it open.
      </p>
    </main>
  );
}
