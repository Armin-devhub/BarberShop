// "This month" analytics for the admin Dashboard. Revenue = final_price_sen of
// completed ('done') cuts. One fetch of done entries over the last ~6 months
// (covers the month, the 7-day trend, and the 6-month trend), plus a tiny status
// query for the completion rate. Aggregated in memory.
//
// Day grouping uses UTC to match queue_date (Postgres current_date, UTC).
// Hour-of-day uses LOCAL time, since "busiest hours" is meaningful in the shop's
// own timezone.

import { supabase } from './supabase';

export interface ServiceStat {
  service_id: string;
  name: string;
  cuts: number;
  revenue_sen: number;
}

export interface BarberMonthStat {
  staff_id: string;
  name: string;
  cuts: number;
  revenue_sen: number;
}

export interface DayStat {
  date: string; // YYYY-MM-DD
  label: string; // weekday short
  revenue_sen: number;
  cuts: number;
}

export interface LabeledValue {
  label: string;
  value: number;
}

export interface MonthRevenue {
  label: string; // short month, e.g. "Jun"
  revenue_sen: number;
}

export interface MonthAnalytics {
  monthLabel: string;
  revenue_sen: number;
  cuts: number;
  avgTicket_sen: number;
  topServices: ServiceStat[];
  topBarbers: BarberMonthStat[];
  last7Days: DayStat[];
  last6Months: MonthRevenue[];
  busiestHours: LabeledValue[];
  byWeekday: LabeledValue[];
  completion: { done: number; cancelled: number; rate: number }; // rate 0–100
  discount: { withCode: number; full: number; rate: number }; // rate 0–100
}

interface DoneRow {
  staff_id: string;
  service_id: string | null;
  final_price_sen: number | null;
  queue_date: string;
  created_at: string;
  discount_code_id: string | null;
  services?: { name: string } | null;
  staff?: { name: string } | null;
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

function fmtHour(h: number): string {
  const ampm = h < 12 ? 'a' : 'p';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}${ampm}`;
}

export async function fetchMonthAnalytics(): Promise<MonthAnalytics> {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const monthStart = new Date(Date.UTC(y, m, 1));
  const monthEndExcl = new Date(Date.UTC(y, m + 1, 1));
  const sixStart = new Date(Date.UTC(y, m - 5, 1)); // first day, 5 months back

  const todayUTC = new Date(Date.UTC(y, m, now.getUTCDate()));
  const sevenAgo = new Date(todayUTC);
  sevenAgo.setUTCDate(todayUTC.getUTCDate() - 6);
  const rangeEndExcl = new Date(todayUTC);
  rangeEndExcl.setUTCDate(todayUTC.getUTCDate() + 1);

  const monthStartStr = ymd(monthStart);
  const monthEndStr = ymd(monthEndExcl);

  const [{ data: doneData }, { data: statusData }] = await Promise.all([
    supabase
      .from('queue_entries')
      .select(
        `staff_id, service_id, final_price_sen, queue_date, created_at, discount_code_id,
         services:service_id ( name ),
         staff:staff_id ( name )`
      )
      .eq('status', 'done')
      .gte('queue_date', ymd(sixStart))
      .lt('queue_date', ymd(rangeEndExcl)),
    supabase
      .from('queue_entries')
      .select('status')
      .gte('queue_date', monthStartStr)
      .lt('queue_date', monthEndStr)
  ]);

  const rows = (doneData ?? []) as unknown as DoneRow[];
  const statuses = (statusData ?? []) as { status: string }[];

  const inMonth = (r: DoneRow) => r.queue_date >= monthStartStr && r.queue_date < monthEndStr;
  const monthRows = rows.filter(inMonth);

  const revenue = monthRows.reduce((s, r) => s + (r.final_price_sen ?? 0), 0);
  const cuts = monthRows.length;

  // ----- top services -----
  const svcMap = new Map<string, ServiceStat>();
  for (const r of monthRows) {
    const id = r.service_id ?? 'custom';
    const name = r.services?.name ?? 'Custom service';
    const cur = svcMap.get(id) ?? { service_id: id, name, cuts: 0, revenue_sen: 0 };
    cur.cuts += 1;
    cur.revenue_sen += r.final_price_sen ?? 0;
    svcMap.set(id, cur);
  }
  const topServices = [...svcMap.values()]
    .sort((a, b) => b.revenue_sen - a.revenue_sen || b.cuts - a.cuts)
    .slice(0, 5);

  // ----- top barbers -----
  const barberMap = new Map<string, BarberMonthStat>();
  for (const r of monthRows) {
    const cur =
      barberMap.get(r.staff_id) ??
      { staff_id: r.staff_id, name: r.staff?.name ?? '—', cuts: 0, revenue_sen: 0 };
    cur.cuts += 1;
    cur.revenue_sen += r.final_price_sen ?? 0;
    barberMap.set(r.staff_id, cur);
  }
  const topBarbers = [...barberMap.values()]
    .sort((a, b) => b.revenue_sen - a.revenue_sen || b.cuts - a.cuts)
    .slice(0, 5);

  // ----- rolling 7-day revenue -----
  const last7Days: DayStat[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayUTC);
    d.setUTCDate(todayUTC.getUTCDate() - i);
    const ds = ymd(d);
    const dayRows = rows.filter((r) => r.queue_date === ds);
    last7Days.push({
      date: ds,
      label: d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
      revenue_sen: dayRows.reduce((s, r) => s + (r.final_price_sen ?? 0), 0),
      cuts: dayRows.length
    });
  }

  // ----- last 6 months revenue -----
  const last6Months: MonthRevenue[] = [];
  for (let i = 5; i >= 0; i--) {
    const mStart = new Date(Date.UTC(y, m - i, 1));
    const mEnd = new Date(Date.UTC(y, m - i + 1, 1));
    const a = ymd(mStart);
    const b = ymd(mEnd);
    const rev = rows
      .filter((r) => r.queue_date >= a && r.queue_date < b)
      .reduce((s, r) => s + (r.final_price_sen ?? 0), 0);
    last6Months.push({
      label: mStart.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }),
      revenue_sen: rev
    });
  }

  // ----- busiest hours (this month, local arrival time) -----
  const hourCounts = new Map<number, number>();
  for (const r of monthRows) {
    if (!r.created_at) continue;
    const h = new Date(r.created_at).getHours();
    hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
  }
  const busiestHours: LabeledValue[] = [];
  if (hourCounts.size > 0) {
    const hrs = [...hourCounts.keys()];
    const minH = Math.min(...hrs);
    const maxH = Math.max(...hrs);
    for (let h = minH; h <= maxH; h++) {
      busiestHours.push({ label: fmtHour(h), value: hourCounts.get(h) ?? 0 });
    }
  }

  // ----- cuts by weekday (Mon→Sun) -----
  const WK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const wkCounts = new Array(7).fill(0);
  for (const r of monthRows) {
    // getUTCDay: 0=Sun..6=Sat → shift so 0=Mon..6=Sun
    const dow = (new Date(r.queue_date).getUTCDay() + 6) % 7;
    wkCounts[dow] += 1;
  }
  const byWeekday: LabeledValue[] = WK.map((label, i) => ({ label, value: wkCounts[i] }));

  // ----- completion rate -----
  let done = 0;
  let cancelled = 0;
  for (const s of statuses) {
    if (s.status === 'done') done += 1;
    else if (s.status === 'cancelled') cancelled += 1;
  }
  const finished = done + cancelled;
  const completion = {
    done,
    cancelled,
    rate: finished > 0 ? Math.round((done / finished) * 100) : 0
  };

  // ----- discount usage (this month, among completed cuts) -----
  let withCode = 0;
  for (const r of monthRows) if (r.discount_code_id) withCode += 1;
  const full = cuts - withCode;
  const discount = {
    withCode,
    full,
    rate: cuts > 0 ? Math.round((withCode / cuts) * 100) : 0
  };

  return {
    monthLabel: monthStart.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    }),
    revenue_sen: revenue,
    cuts,
    avgTicket_sen: cuts > 0 ? Math.round(revenue / cuts) : 0,
    topServices,
    topBarbers,
    last7Days,
    last6Months,
    busiestHours,
    byWeekday,
    completion,
    discount
  };
}
