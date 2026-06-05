// Shared "today so far" summary, used by the admin Dashboard and the Reports
// screen. One fetch of today's queue + open shifts, aggregated into headline
// numbers and a per-barber breakdown. Revenue = what customers actually paid
// (final_price_sen of completed cuts).

import { supabase } from './supabase';

export interface TodayBarberStat {
  staff_id: string;
  name: string;
  onShift: boolean;
  cuts: number; // completed ('done') cuts today
  revenue_sen: number; // sum of final_price_sen for those cuts
  inQueue: number; // waiting + in_progress right now
}

export interface TodaySummary {
  date: string; // YYYY-MM-DD
  revenue_sen: number;
  customersServed: number; // done today, shop-wide
  inQueue: number; // waiting + in_progress now, shop-wide
  onShiftCount: number; // barbers currently clocked in
  perBarber: TodayBarberStat[];
}

export async function fetchTodaySummary(): Promise<TodaySummary> {
  const today = new Date().toISOString().slice(0, 10);

  const [staffRes, queueRes, shiftsRes] = await Promise.all([
    supabase.from('staff').select('id, name, role').eq('role', 'barber'),
    supabase
      .from('queue_entries')
      .select('staff_id, status, final_price_sen')
      .eq('queue_date', today),
    supabase.from('shifts').select('staff_id').is('ended_at', null)
  ]);

  const staff = (staffRes.data ?? []) as { id: string; name: string }[];
  const queue = (queueRes.data ?? []) as {
    staff_id: string;
    status: string;
    final_price_sen: number | null;
  }[];
  const onShift = new Set(
    ((shiftsRes.data ?? []) as { staff_id: string }[]).map((s) => s.staff_id)
  );

  const isActive = (status: string) => status === 'waiting' || status === 'in_progress';

  const perBarber: TodayBarberStat[] = staff
    .map((st) => {
      const mine = queue.filter((q) => q.staff_id === st.id);
      const done = mine.filter((q) => q.status === 'done');
      return {
        staff_id: st.id,
        name: st.name,
        onShift: onShift.has(st.id),
        cuts: done.length,
        revenue_sen: done.reduce((s, q) => s + (q.final_price_sen ?? 0), 0),
        inQueue: mine.filter((q) => isActive(q.status)).length
      };
    })
    // On-shift barbers first, then by today's takings.
    .sort((a, b) => Number(b.onShift) - Number(a.onShift) || b.revenue_sen - a.revenue_sen);

  const doneToday = queue.filter((q) => q.status === 'done');

  return {
    date: today,
    revenue_sen: doneToday.reduce((s, q) => s + (q.final_price_sen ?? 0), 0),
    customersServed: doneToday.length,
    inQueue: queue.filter((q) => isActive(q.status)).length,
    onShiftCount: onShift.size,
    perBarber
  };
}
