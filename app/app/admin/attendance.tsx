import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { formatRM } from '@/lib/types';
import {
  fetchBarberMonthAttendance,
  formatHM,
  type DayAttendance,
  type MonthAttendance
} from '@/lib/attendance';
import { cardShadow, colors, pageHeader, radius, space } from '@/lib/theme';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

interface BarberLite {
  id: string;
  name: string;
}

const WK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function thisPeriod() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  });
}
function shiftPeriod(year: number, month: number, delta: number) {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}
function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function todayYMD(): string {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
function timeOf(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Shift state line over the day: y=0 not started, y=1 ongoing, y=2 ended. The
// line is GREEN, but turns RED wherever the barber is on a break (until they
// continue). Break time ranges are listed as chips below.
function DayTimeline({ day }: { day: DayAttendance }) {
  const [w, setW] = useState(0);
  const spans = day.shiftSpans;
  if (spans.length === 0) return null;

  const now = Date.now();
  const ms = (iso: string) => new Date(iso).getTime();
  // X axis = the full calendar day, 12 AM → 12 AM (local), so events sit at their
  // real clock position. For an open shift we only draw up to "now".
  const dayStart = new Date(day.date + 'T00:00:00').getTime();
  const dayEnd = dayStart + 24 * 3600 * 1000;
  const drawEnd = day.openShift ? Math.min(now, dayEnd) : dayEnd;
  const win = dayEnd - dayStart;

  const H = 118;
  const padX = 8;
  const padTop = 16;
  const padBot = 18;
  const xFor = (t: number) => padX + ((t - dayStart) / win) * (Math.max(1, w) - 2 * padX);
  const yFor = (lvl: number) => padTop + (1 - lvl / 2) * (H - padTop - padBot);

  const inBreak = (t: number) =>
    day.breakIntervals.some((br) => t >= ms(br.start) && t < (br.end ? ms(br.end) : now));
  const inSpan = (t: number) =>
    spans.some((sp) => t >= ms(sp.start) && t < (sp.end ? ms(sp.end) : now));
  const startedBefore = (t: number) => spans.some((sp) => t >= ms(sp.start));
  const stateAt = (t: number): { y: number; color: string } => {
    if (inBreak(t)) return { y: 1, color: colors.danger };
    if (inSpan(t)) return { y: 1, color: colors.ok };
    if (!startedBefore(t)) return { y: 0, color: colors.ok };
    return { y: 2, color: colors.ok };
  };

  // Segment the day at every shift/break boundary.
  const bset = new Set<number>([dayStart, drawEnd]);
  for (const sp of spans) {
    bset.add(ms(sp.start));
    bset.add(sp.end ? ms(sp.end) : now);
  }
  for (const br of day.breakIntervals) {
    bset.add(ms(br.start));
    bset.add(br.end ? ms(br.end) : now);
  }
  const bounds = [...bset].filter((t) => t >= dayStart && t <= drawEnd).sort((a, b) => a - b);

  const segs: { x0: number; x1: number; y: number; color: string }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const st = stateAt((bounds[i] + bounds[i + 1]) / 2);
    segs.push({ x0: xFor(bounds[i]), x1: xFor(bounds[i + 1]), y: yFor(st.y), color: st.color });
  }
  const last = segs[segs.length - 1];
  // Final marker: a closed shift ends at "Ended" (even if that's at the midnight
  // edge); an open shift sits at "Ongoing" at the last drawn point.
  const endLevel = day.openShift ? 1 : 2;
  const endX = xFor(drawEnd);
  const endY = yFor(endLevel);

  const guides = [
    { lvl: 2, label: 'Ended' },
    { lvl: 1, label: 'Ongoing' },
    { lvl: 0, label: 'Not started' }
  ];

  return (
    <View style={s.tlWrap}>
      <Text style={s.tlHeading}>Shift activity</Text>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && (
          <Svg width={w} height={H}>
            {/* vertical hour gridlines at 6h marks */}
            {[6, 12, 18].map((hh) => {
              const x = xFor(dayStart + hh * 3600 * 1000);
              return (
                <Line
                  key={`v${hh}`}
                  x1={x}
                  y1={padTop - 6}
                  x2={x}
                  y2={H - padBot + 2}
                  stroke={colors.border}
                  strokeWidth={1}
                  strokeDasharray="2 5"
                />
              );
            })}
            {/* level guides + labels */}
            {guides.map((g) => (
              <Line
                key={`g${g.lvl}`}
                x1={padX}
                y1={yFor(g.lvl)}
                x2={w - padX}
                y2={yFor(g.lvl)}
                stroke={colors.border}
                strokeWidth={1}
                strokeDasharray="3 4"
              />
            ))}
            {guides.map((g) => (
              <SvgText
                key={`gl${g.lvl}`}
                x={w - padX}
                y={yFor(g.lvl) - 3}
                fontSize={8}
                fontWeight="600"
                fill={colors.subtle}
                textAnchor="end"
              >
                {g.label}
              </SvgText>
            ))}
            {/* vertical risers between levels (green = shift transition) */}
            {segs.map((sg, i) => {
              if (i === 0) return null;
              const prev = segs[i - 1];
              if (prev.y === sg.y) return null;
              return (
                <Line
                  key={`r${i}`}
                  x1={sg.x0}
                  y1={prev.y}
                  x2={sg.x0}
                  y2={sg.y}
                  stroke={colors.ok}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              );
            })}
            {/* horizontal state segments (green working / red break) */}
            {segs.map((sg, i) => (
              <Line
                key={`s${i}`}
                x1={sg.x0}
                y1={sg.y}
                x2={sg.x1}
                y2={sg.y}
                stroke={sg.color}
                strokeWidth={3}
                strokeLinecap="round"
              />
            ))}
            {last && last.y !== endY && (
              <Line
                x1={endX}
                y1={last.y}
                x2={endX}
                y2={endY}
                stroke={colors.ok}
                strokeWidth={3}
                strokeLinecap="round"
              />
            )}
            {last && <Circle cx={endX} cy={endY} r={4} fill={colors.ok} />}
          </Svg>
        )}
        <View style={s.tlAxis}>
          {['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'].map((l, i) => (
            <Text key={i} style={s.tlAxisLabel}>
              {l}
            </Text>
          ))}
        </View>
      </View>

      <View style={s.tlLegendRow}>
        <View style={[s.tlDot, { backgroundColor: colors.ok }]} />
        <Text style={s.tlLegendText}>Working</Text>
        <View style={[s.tlDot, { backgroundColor: colors.danger, marginLeft: space.md }]} />
        <Text style={s.tlLegendText}>On break</Text>
      </View>

      {day.breakIntervals.length > 0 && (
        <View style={s.tlChips}>
          <Text style={s.tlChipsLabel}>Breaks</Text>
          {day.breakIntervals.map((br, i) => (
            <View key={i} style={s.tlChip}>
              <Text style={s.tlChipText}>
                {timeOf(br.start)}–{br.end ? timeOf(br.end) : 'now'} ·{' '}
                {formatHM(((br.end ? ms(br.end) : now) - ms(br.start)) / 1000)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function AdminAttendance() {
  const [barbers, setBarbers] = useState<BarberLite[]>([]);
  const [selectedBarber, setSelectedBarber] = useState<string | null>(null);
  const [period, setPeriod] = useState(thisPeriod());
  const [data, setData] = useState<MonthAttendance | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('staff')
        .select('id, name')
        .eq('active', true)
        .eq('role', 'barber')
        .order('name');
      const list = (data as BarberLite[]) ?? [];
      setBarbers(list);
      setSelectedBarber((cur) => cur ?? list[0]?.id ?? null);
    })();
  }, []);

  const load = useCallback(async () => {
    if (!selectedBarber) return;
    setData(null);
    const res = await fetchBarberMonthAttendance(selectedBarber, period.year, period.month);
    setData(res);
  }, [selectedBarber, period]);

  useEffect(() => {
    load();
    setSelectedDate(null);
  }, [load]);

  const today = todayYMD();
  const cur = thisPeriod();
  const offCurrentMonth = period.year !== cur.year || period.month !== cur.month;
  const daysInMonth = new Date(period.year, period.month, 0).getDate();
  const firstWeekday = (new Date(period.year, period.month - 1, 1).getDay() + 6) % 7; // Mon=0

  // Build a padded cell array (leading blanks + day numbers), chunked into weeks.
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const selected: DayAttendance | undefined = selectedDate
    ? data?.days.get(selectedDate)
    : undefined;

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.scrollContent}>
      <View style={pageHeader.wrap}>
        <Text style={pageHeader.subtitle}>Attendance</Text>
        <Text style={pageHeader.title}>Shifts & Breaks</Text>
      </View>

      {/* Barber filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterRow}
      >
        {barbers.map((b) => {
          const on = selectedBarber === b.id;
          return (
            <Pressable
              key={b.id}
              onPress={() => setSelectedBarber(b.id)}
              style={[s.filterPill, on && s.filterPillOn]}
            >
              <View style={[s.filterAvatar, on && s.filterAvatarOn]}>
                <Text style={[s.filterAvatarText, on && s.filterAvatarTextOn]}>
                  {b.name.trim().charAt(0).toUpperCase() || '?'}
                </Text>
              </View>
              <Text style={[s.filterPillText, on && s.filterPillTextOn]}>{b.name}</Text>
            </Pressable>
          );
        })}
        {barbers.length === 0 && <Text style={s.muted}>No active barbers.</Text>}
      </ScrollView>

      {/* Month selector */}
      <View style={s.monthBar}>
        <Pressable
          hitSlop={8}
          onPress={() => setPeriod((p) => shiftPeriod(p.year, p.month, -1))}
          style={s.monthArrow}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <View style={s.monthCenter}>
          <Text style={s.monthLabel}>{monthLabel(period.year, period.month)}</Text>
          {offCurrentMonth && (
            <Pressable hitSlop={6} onPress={() => setPeriod(thisPeriod())} style={s.todayBtn}>
              <Ionicons name="today-outline" size={12} color={colors.accentDeep} />
              <Text style={s.todayBtnText}>Today</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => setPeriod((p) => shiftPeriod(p.year, p.month, 1))}
          style={s.monthArrow}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Month summary */}
      {data && (
        <View style={s.summaryCard}>
          <View style={s.summaryItem}>
            <View style={s.summaryIcon}>
              <Ionicons name="calendar-outline" size={15} color={colors.accentDeep} />
            </View>
            <Text style={s.summaryValue}>{data.daysWorked}</Text>
            <Text style={s.summaryLabel}>Days worked</Text>
          </View>
          <View style={s.summaryDivider} />
          <View style={s.summaryItem}>
            <View style={s.summaryIcon}>
              <Ionicons name="time-outline" size={15} color={colors.accentDeep} />
            </View>
            <Text style={s.summaryValue}>{formatHM(data.totalNetSeconds)}</Text>
            <Text style={s.summaryLabel}>Net worked</Text>
          </View>
          <View style={s.summaryDivider} />
          <View style={s.summaryItem}>
            <View style={s.summaryIcon}>
              <Ionicons name="people-outline" size={15} color={colors.accentDeep} />
            </View>
            <Text style={s.summaryValue}>{data.totalCustomers}</Text>
            <Text style={s.summaryLabel}>Customers</Text>
          </View>
        </View>
      )}

      {/* Calendar */}
      <View style={s.calendarCard}>
        {data === null ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <>
            <View style={s.weekHeader}>
              {WK.map((w) => (
                <Text key={w} style={s.weekHeaderText}>
                  {w}
                </Text>
              ))}
            </View>
            {weeks.map((week, wi) => (
              <View key={wi} style={s.weekRow}>
                {week.map((day, di) => {
                  if (day === null) return <View key={di} style={s.dayCell} />;
                  const dateStr = ymd(period.year, period.month, day);
                  const att = data.days.get(dateStr);
                  const worked = !!att?.hasShift;
                  const isFuture = dateStr > today;
                  const isToday = dateStr === today;
                  const isSelected = dateStr === selectedDate;
                  const tone = worked
                    ? s.dayWorked
                    : isFuture || isToday
                      ? s.dayNeutral
                      : s.dayAbsent;
                  return (
                    <Pressable
                      key={di}
                      style={[s.dayCell, s.dayCellFilled, tone, isSelected && s.daySelected]}
                      onPress={() => setSelectedDate(dateStr)}
                    >
                      <Text
                        style={[
                          s.dayNum,
                          worked && s.dayNumWorked,
                          !worked && !isFuture && !isToday && s.dayNumAbsent,
                          isToday && s.dayNumToday
                        ]}
                      >
                        {day}
                      </Text>
                      {isToday && <View style={s.todayDot} />}
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <View style={s.legendRow}>
              <View style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: colors.ok }]} />
                <Text style={s.legendText}>Worked</Text>
              </View>
              <View style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: colors.danger }]} />
                <Text style={s.legendText}>No shift</Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* Selected day detail */}
      {selectedDate && (
        <View style={s.detailCard}>
          <Text style={s.detailDate}>
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long'
            })}
          </Text>

          {!selected || !selected.hasShift ? (
            <Text style={s.muted}>No shift recorded on this day.</Text>
          ) : (
            <>
              <View style={s.detailHero}>
                <Text style={s.detailHeroValue}>{formatHM(selected.netSeconds)}</Text>
                <Text style={s.detailHeroLabel}>
                  net worked{selected.openShift ? ' · still on shift' : ''}
                </Text>
              </View>

              <DayTimeline day={selected} />

              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Total shift time</Text>
                <Text style={s.detailValue}>{formatHM(selected.shiftSeconds)}</Text>
              </View>
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>
                  Breaks ({selected.breakCount})
                </Text>
                <Text style={s.detailValue}>− {formatHM(selected.breakSeconds)}</Text>
              </View>
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Customers served</Text>
                <Text style={s.detailValue}>{selected.customers}</Text>
              </View>
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Revenue</Text>
                <Text style={s.detailValue}>{formatRM(selected.revenue_sen)}</Text>
              </View>
              <View style={[s.detailRow, s.detailRowLast]}>
                <Text style={s.detailLabel}>First in · Last out</Text>
                <Text style={s.detailValue}>
                  {timeOf(selected.firstStart)} ·{' '}
                  {selected.openShift ? 'on shift' : timeOf(selected.lastEnd)}
                </Text>
              </View>
            </>
          )}
        </View>
      )}

      {!selectedDate && data && (
        <Text style={s.hint}>Tap a day to see its detail.</Text>
      )}
    </ScrollView>
  );
}

const CELL = 44;

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },
  muted: { color: colors.muted, fontSize: 13 },
  hint: { color: colors.subtle, fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: space.sm },

  filterRow: { gap: space.xs, paddingVertical: 2, paddingRight: space.md, alignItems: 'center' },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 5,
    paddingRight: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  filterPillOn: { backgroundColor: colors.text, borderColor: colors.text },
  filterPillText: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.2 },
  filterPillTextOn: { color: colors.primaryText },
  filterAvatar: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  filterAvatarOn: { backgroundColor: 'rgba(255,255,255,0.2)' },
  filterAvatarText: { fontSize: 11, fontWeight: '800', color: colors.accentDeep },
  filterAvatarTextOn: { color: colors.primaryText },

  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    ...cardShadow
  },
  monthArrow: {
    width: 40,
    height: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center'
  },
  monthCenter: { flex: 1, alignItems: 'center', gap: 3 },
  monthLabel: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: 0.2
  },
  todayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2
  },
  todayBtnText: { fontSize: 10, fontWeight: '700', color: colors.accentDeep, letterSpacing: 0.3 },

  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    ...cardShadow
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 2 },
  summaryIcon: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4
  },
  summaryValue: { fontSize: 18, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  summaryLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase'
  },
  summaryDivider: { width: 1, height: 34, backgroundColor: colors.border },

  calendarCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    ...cardShadow
  },
  weekHeader: { flexDirection: 'row', marginBottom: 6 },
  weekHeaderText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    letterSpacing: 0.4
  },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  dayCell: { flex: 1, height: CELL, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
  dayCellFilled: { borderRadius: radius.sm, borderWidth: 1 },
  dayWorked: { backgroundColor: colors.okSoft, borderColor: colors.ok },
  dayAbsent: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  dayNeutral: { backgroundColor: colors.surface, borderColor: colors.border },
  daySelected: { borderWidth: 2, borderColor: colors.text },
  dayNum: { fontSize: 14, fontWeight: '600', color: colors.muted },
  dayNumWorked: { color: colors.ok, fontWeight: '700' },
  dayNumAbsent: { color: colors.danger },
  dayNumToday: { fontWeight: '800' },
  todayDot: {
    position: 'absolute',
    bottom: 5,
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.accent
  },

  legendRow: { flexDirection: 'row', gap: space.lg, marginTop: space.xs, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 3 },
  legendText: { fontSize: 11, color: colors.muted, fontWeight: '600' },

  detailCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: 4,
    ...cardShadow
  },
  detailDate: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: space.xs },
  detailHero: {
    backgroundColor: colors.okSoft,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    marginBottom: space.sm
  },
  detailHeroValue: { fontSize: 28, fontWeight: '800', color: colors.ok, letterSpacing: -0.5 },
  detailHeroLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginTop: 2
  },
  // Shift activity spline
  tlWrap: { marginBottom: space.sm },
  tlHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 2
  },
  tlAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  tlAxisLabel: { fontSize: 10, color: colors.subtle, fontWeight: '600' },
  tlLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  tlDot: { width: 9, height: 9, borderRadius: 3 },
  tlLegendText: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  tlChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: space.sm },
  tlChipsLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginRight: 2
  },
  tlChip: {
    backgroundColor: colors.warnSoft,
    borderWidth: 1,
    borderColor: colors.warn,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3
  },
  tlChipText: { fontSize: 11, color: colors.warn, fontWeight: '600' },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { fontSize: 13, color: colors.muted },
  detailValue: { fontSize: 14, fontWeight: '700', color: colors.text }
});
