// Attendance aggregation for one barber over one month. Combines every shift in
// a day into a single working span and subtracts break time, so "net worked" is
// the barber's real time on the job. Used by the Attendance page and the report.
//
// Shifts/breaks are grouped by LOCAL calendar day (the shop's own timezone — the
// device clock), which is what "did they show up that day" means in practice.

import { supabase } from './supabase';

export interface DayAttendance {
  date: string; // YYYY-MM-DD (local)
  hasShift: boolean;
  shiftSeconds: number; // sum of all shift spans that day
  breakSeconds: number; // sum of counted break time
  netSeconds: number; // shiftSeconds − breakSeconds (>= 0)
  breakCount: number;
  customers: number; // 'done' cuts that day
  revenue_sen: number;
  firstStart: string | null; // ISO of earliest clock-in
  lastEnd: string | null; // ISO of latest clock-out (null while a shift is open)
  openShift: boolean; // a shift is still running
  shiftSpans: { start: string; end: string | null }[]; // raw spans for the timeline
  breakIntervals: { start: string; end: string | null }[]; // counted breaks for the timeline
}

export interface MonthAttendance {
  days: Map<string, DayAttendance>;
  daysWorked: number;
  totalNetSeconds: number;
  totalBreakSeconds: number;
  totalCustomers: number;
  totalRevenueSen: number;
}

function localYMD(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatHM(totalSeconds: number): string {
  const mins = Math.max(0, Math.round(totalSeconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// ----- Year roll-up (for the annual PDF report) -----

export interface BarberMonthRow {
  month: number; // 1-based
  label: string; // short month, e.g. "Jun"
  daysWorked: number;
  shiftSeconds: number;
  breakSeconds: number;
  netSeconds: number;
  customers: number;
}

export interface BarberYearAttendance {
  staff_id: string;
  name: string;
  months: BarberMonthRow[]; // only months with activity
  totalDaysWorked: number;
  totalNetSeconds: number;
  totalBreakSeconds: number;
  totalCustomers: number;
}

// Aggregate a year's worth of shifts/breaks/done-cuts into per-barber, per-month
// attendance. Shifts/breaks group by local month; customers by queue_date month.
export function computeYearAttendance(
  staff: { id: string; name: string }[],
  shifts: { staff_id: string; started_at: string; ended_at: string | null }[],
  breaks: { staff_id: string; started_at: string | null; ended_at: string | null }[],
  done: { staff_id: string; queue_date: string; status: string }[]
): BarberYearAttendance[] {
  const now = Date.now();
  interface Agg {
    shiftSec: number[];
    breakSec: number[];
    days: Set<string>[];
    customers: number[];
  }
  const perStaff = new Map<string, Agg>();
  for (const st of staff) {
    perStaff.set(st.id, {
      shiftSec: new Array(12).fill(0),
      breakSec: new Array(12).fill(0),
      days: Array.from({ length: 12 }, () => new Set<string>()),
      customers: new Array(12).fill(0)
    });
  }

  for (const sh of shifts) {
    const agg = perStaff.get(sh.staff_id);
    if (!agg) continue;
    const start = new Date(sh.started_at);
    const mi = start.getMonth();
    const endMs = sh.ended_at ? new Date(sh.ended_at).getTime() : now;
    agg.shiftSec[mi] += Math.max(0, (endMs - start.getTime()) / 1000);
    agg.days[mi].add(localYMD(start));
  }

  for (const br of breaks) {
    if (!br.started_at) continue;
    const agg = perStaff.get(br.staff_id);
    if (!agg) continue;
    const start = new Date(br.started_at);
    const mi = start.getMonth();
    const endMs = br.ended_at ? new Date(br.ended_at).getTime() : now;
    agg.breakSec[mi] += Math.max(0, (endMs - start.getTime()) / 1000);
  }

  for (const q of done) {
    if (q.status !== 'done') continue;
    const agg = perStaff.get(q.staff_id);
    if (!agg) continue;
    const mi = parseInt(q.queue_date.slice(5, 7), 10) - 1;
    if (mi >= 0 && mi < 12) agg.customers[mi] += 1;
  }

  return staff
    .map((st) => {
      const agg = perStaff.get(st.id)!;
      const months: BarberMonthRow[] = [];
      let tDays = 0;
      let tNet = 0;
      let tBreak = 0;
      let tCust = 0;
      for (let mi = 0; mi < 12; mi++) {
        const daysWorked = agg.days[mi].size;
        const shiftSeconds = agg.shiftSec[mi];
        const breakSeconds = agg.breakSec[mi];
        const customers = agg.customers[mi];
        if (daysWorked === 0 && customers === 0) continue;
        const netSeconds = Math.max(0, shiftSeconds - breakSeconds);
        months.push({
          month: mi + 1,
          label: new Date(2000, mi, 1).toLocaleDateString(undefined, { month: 'short' }),
          daysWorked,
          shiftSeconds,
          breakSeconds,
          netSeconds,
          customers
        });
        tDays += daysWorked;
        tNet += netSeconds;
        tBreak += breakSeconds;
        tCust += customers;
      }
      return {
        staff_id: st.id,
        name: st.name,
        months,
        totalDaysWorked: tDays,
        totalNetSeconds: tNet,
        totalBreakSeconds: tBreak,
        totalCustomers: tCust
      };
    })
    .filter((b) => b.months.length > 0);
}

interface ShiftRow {
  started_at: string;
  ended_at: string | null;
}
interface BreakRow {
  requested_at: string;
  started_at: string | null;
  ended_at: string | null;
}
interface DoneRow {
  queue_date: string;
  final_price_sen: number | null;
}

export async function fetchBarberMonthAttendance(
  staffId: string,
  year: number,
  month: number // 1-based
): Promise<MonthAttendance> {
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month, 1, 0, 0, 0, 0);
  const startISO = monthStart.toISOString();
  const endISO = monthEnd.toISOString();
  const startYMD = localYMD(monthStart);
  const endYMD = localYMD(monthEnd);
  const now = Date.now();

  const [shiftsRes, breaksRes, doneRes] = await Promise.all([
    supabase
      .from('shifts')
      .select('started_at, ended_at')
      .eq('staff_id', staffId)
      .gte('started_at', startISO)
      .lt('started_at', endISO),
    supabase
      .from('breaks')
      .select('requested_at, started_at, ended_at')
      .eq('staff_id', staffId)
      .gte('requested_at', startISO)
      .lt('requested_at', endISO),
    supabase
      .from('queue_entries')
      .select('queue_date, final_price_sen')
      .eq('staff_id', staffId)
      .eq('status', 'done')
      .gte('queue_date', startYMD)
      .lt('queue_date', endYMD)
  ]);

  const shifts = (shiftsRes.data ?? []) as ShiftRow[];
  const breaks = (breaksRes.data ?? []) as BreakRow[];
  const done = (doneRes.data ?? []) as DoneRow[];

  const days = new Map<string, DayAttendance>();
  const ensure = (date: string): DayAttendance => {
    let d = days.get(date);
    if (!d) {
      d = {
        date,
        hasShift: false,
        shiftSeconds: 0,
        breakSeconds: 0,
        netSeconds: 0,
        breakCount: 0,
        customers: 0,
        revenue_sen: 0,
        firstStart: null,
        lastEnd: null,
        openShift: false,
        shiftSpans: [],
        breakIntervals: []
      };
      days.set(date, d);
    }
    return d;
  };

  for (const sh of shifts) {
    const start = new Date(sh.started_at);
    const day = ensure(localYMD(start));
    const endMs = sh.ended_at ? new Date(sh.ended_at).getTime() : now;
    day.hasShift = true;
    day.shiftSpans.push({ start: sh.started_at, end: sh.ended_at });
    day.shiftSeconds += Math.max(0, (endMs - start.getTime()) / 1000);
    if (!day.firstStart || start.getTime() < new Date(day.firstStart).getTime()) {
      day.firstStart = sh.started_at;
    }
    if (sh.ended_at) {
      if (!day.lastEnd || new Date(sh.ended_at).getTime() > new Date(day.lastEnd).getTime()) {
        day.lastEnd = sh.ended_at;
      }
    } else {
      day.openShift = true;
    }
  }

  for (const br of breaks) {
    if (!br.started_at) continue; // pending break that hasn't begun counting
    const start = new Date(br.started_at);
    const day = ensure(localYMD(start));
    const endMs = br.ended_at ? new Date(br.ended_at).getTime() : now;
    const dur = Math.max(0, (endMs - start.getTime()) / 1000);
    day.breakSeconds += dur;
    day.breakCount += 1;
    day.breakIntervals.push({ start: br.started_at, end: br.ended_at });
  }

  for (const q of done) {
    const day = ensure(q.queue_date);
    day.customers += 1;
    day.revenue_sen += q.final_price_sen ?? 0;
  }

  let daysWorked = 0;
  let totalNetSeconds = 0;
  let totalBreakSeconds = 0;
  let totalCustomers = 0;
  let totalRevenueSen = 0;
  for (const d of days.values()) {
    d.netSeconds = Math.max(0, d.shiftSeconds - d.breakSeconds);
    if (d.hasShift) {
      daysWorked += 1;
      totalNetSeconds += d.netSeconds;
      totalBreakSeconds += d.breakSeconds;
    }
    totalCustomers += d.customers;
    totalRevenueSen += d.revenue_sen;
  }

  return {
    days,
    daysWorked,
    totalNetSeconds,
    totalBreakSeconds,
    totalCustomers,
    totalRevenueSen
  };
}
