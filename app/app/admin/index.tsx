import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { fetchTodaySummary, type TodaySummary } from '@/lib/today';
import { fetchMonthAnalytics, type MonthAnalytics } from '@/lib/analytics';
import { formatRM } from '@/lib/types';
import { dash, chartPalette, pageHeader, radius, space } from '@/lib/theme';
import {
  AreaChart,
  BarChart,
  Donut,
  GradientBg,
  Sparkline,
  type DonutSlice
} from '@/components/Charts';

// Measures its own width and hands it to a render-prop child, so SVG charts get
// a concrete pixel width without each call site managing its own state.
function Measured({
  height,
  children
}: {
  height?: number;
  children: (w: number) => ReactNode;
}) {
  const [w, setW] = useState(0);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? children(w) : height ? <View style={{ height }} /> : null}
    </View>
  );
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

type IonName = keyof typeof Ionicons.glyphMap;

// A compact KPI tile: soft icon chip, big value, small label.
function KpiTile({
  icon,
  label,
  value,
  color,
  soft
}: {
  icon: IonName;
  label: string;
  value: string;
  color: string;
  soft: string;
}) {
  return (
    <View style={s.tile}>
      <View style={[s.tileIcon, { backgroundColor: soft }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={s.tileValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={s.tileLabel}>{label}</Text>
    </View>
  );
}

// Ranked horizontal bar (rank chip · label · colored fill · value).
function RankBar({
  rank,
  label,
  valueLabel,
  pct,
  color
}: {
  rank: number;
  label: string;
  valueLabel: string;
  pct: number;
  color: string;
}) {
  return (
    <View style={s.rankRow}>
      <View style={[s.rankChip, { backgroundColor: rank === 1 ? color : dash.track }]}>
        <Text style={[s.rankText, { color: rank === 1 ? '#fff' : dash.muted }]}>{rank}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.barTop}>
          <Text style={s.barLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={s.barValue}>{valueLabel}</Text>
        </View>
        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${Math.max(3, pct)}%`, backgroundColor: color }]} />
        </View>
      </View>
    </View>
  );
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState<TodaySummary | null>(null);
  const [analytics, setAnalytics] = useState<MonthAnalytics | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [featSize, setFeatSize] = useState({ w: 0, h: 0 });
  const [areaW, setAreaW] = useState(0);

  const load = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([fetchTodaySummary(), fetchMonthAnalytics()]);
      setSummary(t);
      setAnalytics(a);
    } catch {
      // Leave the previous data in place on a transient error.
    }
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`admin-dashboard-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Today-vs-yesterday delta from the 7-day series.
  const series = analytics?.last7Days.map((d) => d.revenue_sen) ?? [];
  const todayRev = series.length ? series[series.length - 1] : 0;
  const yRev = series.length > 1 ? series[series.length - 2] : 0;
  let deltaText = 'vs yesterday';
  let deltaUp = true;
  if (yRev > 0) {
    const p = Math.round(((todayRev - yRev) / yRev) * 100);
    deltaUp = p >= 0;
    deltaText = `${deltaUp ? '▲' : '▼'} ${Math.abs(p)}% vs yesterday`;
  } else if (todayRev > 0) {
    deltaText = '▲ new today';
  }

  // Donut service-mix slices + legend.
  let slices: DonutSlice[] = [];
  let legend: { name: string; color: string; value: number }[] = [];
  if (analytics) {
    const sumTop = analytics.topServices.reduce((acc, x) => acc + x.revenue_sen, 0);
    const others = Math.max(0, analytics.revenue_sen - sumTop);
    slices = analytics.topServices.map((x, i) => ({
      value: x.revenue_sen,
      color: chartPalette[i % chartPalette.length]
    }));
    legend = analytics.topServices.map((x, i) => ({
      name: x.name,
      color: chartPalette[i % chartPalette.length],
      value: x.revenue_sen
    }));
    if (others > 0) {
      slices.push({ value: others, color: '#CBD5E1' });
      legend.push({ name: 'Others', color: '#CBD5E1', value: others });
    }
  }
  const totalRev = analytics?.revenue_sen || 1;

  return (
    <ScrollView
      style={s.flex}
      contentContainerStyle={s.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={pageHeader.wrap}>
        <Text style={s.kicker}>DASHBOARD</Text>
        <Text style={s.h1}>Today</Text>
        <Text style={s.dateText}>{todayLabel()}</Text>
      </View>

      {summary === null ? (
        <ActivityIndicator color={dash.muted} style={{ marginTop: space.lg }} />
      ) : (
        <>
          {/* Feature card — today's revenue */}
          <View
            style={s.feature}
            onLayout={(e) =>
              setFeatSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
            }
          >
            <GradientBg
              width={featSize.w}
              height={featSize.h}
              from={dash.primary}
              to={dash.violet}
              radius={18}
            />
            <View style={s.featContent}>
              <View style={s.featTopRow}>
                <Text style={s.featKicker}>REVENUE TODAY</Text>
                <View style={s.featLive}>
                  <View style={s.featDot} />
                  <Text style={s.featLiveText}>LIVE</Text>
                </View>
              </View>
              <Text style={s.featValue}>{formatRM(summary.revenue_sen)}</Text>
              <View style={s.featBottom}>
                <View style={s.featDelta}>
                  <Text style={s.featDeltaText}>{deltaText}</Text>
                </View>
                <View style={s.featSpark}>
                  <Sparkline values={series} width={120} height={40} color="#FFFFFF" />
                </View>
              </View>
            </View>
          </View>

          {/* Today KPI tiles */}
          <View style={s.tileRow}>
            <KpiTile
              icon="people-outline"
              label="Served"
              value={summary.customersServed.toLocaleString()}
              color={dash.emerald}
              soft={dash.emeraldSoft}
            />
            <KpiTile
              icon="time-outline"
              label="In queue"
              value={summary.inQueue.toLocaleString()}
              color={dash.amber}
              soft={dash.amberSoft}
            />
            <KpiTile
              icon="cut-outline"
              label="On shift"
              value={summary.onShiftCount.toLocaleString()}
              color={dash.sky}
              soft={dash.skySoft}
            />
          </View>

          {analytics && (
            <>
              <Text style={s.sectionLabel}>THIS MONTH · {analytics.monthLabel.toUpperCase()}</Text>

              <View style={s.tileRow}>
                <KpiTile
                  icon="cash-outline"
                  label="Revenue"
                  value={formatRM(analytics.revenue_sen)}
                  color={dash.primary}
                  soft={dash.primarySoft}
                />
                <KpiTile
                  icon="people-outline"
                  label="Cuts"
                  value={analytics.cuts.toLocaleString()}
                  color={dash.violet}
                  soft={dash.violetSoft}
                />
                <KpiTile
                  icon="pricetag-outline"
                  label="Avg ticket"
                  value={formatRM(analytics.avgTicket_sen)}
                  color={dash.emerald}
                  soft={dash.emeraldSoft}
                />
              </View>

              {/* Charts — responsive 2-up grid (8 cards → 2×4 on a wide screen) */}
              <View style={s.chartsGrid}>
                {/* Revenue area chart */}
                <View style={[s.card, s.gridCard]}>
                  <View style={s.cardHeadRow}>
                    <Text style={s.cardHeading}>Revenue · last 7 days</Text>
                    <Text style={s.cardHeadHint}>RM</Text>
                  </View>
                  <View onLayout={(e) => setAreaW(e.nativeEvent.layout.width)}>
                    <AreaChart values={series} width={areaW} height={132} color={dash.primary} />
                    <View style={s.axisRow}>
                      {analytics.last7Days.map((d) => (
                        <Text key={d.date} style={s.axisLabel}>
                          {d.label}
                        </Text>
                      ))}
                    </View>
                  </View>
                </View>

                {/* Revenue · last 6 months */}
                <View style={[s.card, s.gridCard]}>
                  <View style={s.cardHeadRow}>
                    <Text style={s.cardHeading}>Revenue · last 6 months</Text>
                    <Text style={s.cardHeadHint}>RM</Text>
                  </View>
                  {analytics.last6Months.every((x) => x.revenue_sen === 0) ? (
                    <Text style={s.emptyMini}>No revenue in the last 6 months.</Text>
                  ) : (
                    <Measured height={166}>
                      {(w) => (
                        <>
                          <BarChart
                            values={analytics.last6Months.map((x) => x.revenue_sen)}
                            width={w}
                            height={150}
                            color={dash.primary}
                            showValues
                            formatValue={(v) => `${Math.round(v / 100)}`}
                          />
                          <View style={s.axisRow}>
                            {analytics.last6Months.map((x, i) => (
                              <Text key={i} style={s.axisLabel}>
                                {x.label}
                              </Text>
                            ))}
                          </View>
                        </>
                      )}
                    </Measured>
                  )}
                </View>

                {/* Busiest hours */}
                <View style={[s.card, s.gridCard]}>
                  <Text style={s.cardHeading}>Busiest hours</Text>
                  {analytics.busiestHours.length === 0 ? (
                    <Text style={s.emptyMini}>Not enough data yet.</Text>
                  ) : (
                    <Measured height={150}>
                      {(w) => (
                        <>
                          <BarChart
                            values={analytics.busiestHours.map((x) => x.value)}
                            width={w}
                            height={130}
                            color={dash.sky}
                            showValues
                          />
                          <View style={s.axisRow}>
                            {analytics.busiestHours.map((x, i) => (
                              <Text key={i} style={s.axisLabelSm}>
                                {x.label}
                              </Text>
                            ))}
                          </View>
                        </>
                      )}
                    </Measured>
                  )}
                </View>

                {/* Cuts by weekday */}
                <View style={[s.card, s.gridCard]}>
                  <Text style={s.cardHeading}>Cuts by weekday</Text>
                  {analytics.cuts === 0 ? (
                    <Text style={s.emptyMini}>No cuts yet this month.</Text>
                  ) : (
                    <Measured height={150}>
                      {(w) => (
                        <>
                          <BarChart
                            values={analytics.byWeekday.map((x) => x.value)}
                            width={w}
                            height={130}
                            color={dash.violet}
                            showValues
                          />
                          <View style={s.axisRow}>
                            {analytics.byWeekday.map((x, i) => (
                              <Text key={i} style={s.axisLabel}>
                                {x.label}
                              </Text>
                            ))}
                          </View>
                        </>
                      )}
                    </Measured>
                  )}
                </View>

                {/* Service mix donut */}
                <View style={[s.card, s.gridCard]}>
                  <Text style={s.cardHeading}>Service mix</Text>
                  {analytics.cuts === 0 ? (
                    <Text style={s.emptyMini}>No cuts yet this month.</Text>
                  ) : (
                    <View style={s.donutRow}>
                      <View style={s.donutWrap}>
                        <Donut data={slices} size={138} thickness={20} />
                        <View style={s.donutCenter}>
                          <Text style={s.donutCenterValue}>{analytics.cuts}</Text>
                          <Text style={s.donutCenterLabel}>cuts</Text>
                        </View>
                      </View>
                      <View style={s.legend}>
                        {legend.map((l) => (
                          <View key={l.name} style={s.legendRow}>
                            <View style={[s.legendDot, { backgroundColor: l.color }]} />
                            <Text style={s.legendName} numberOfLines={1}>
                              {l.name}
                            </Text>
                            <Text style={s.legendPct}>
                              {Math.round((l.value / totalRev) * 100)}%
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>

                {/* Completion rate */}
                <View style={[s.card, s.gridCard]}>
                  <Text style={s.cardHeading}>Completion · this month</Text>
                  {analytics.completion.done + analytics.completion.cancelled === 0 ? (
                    <Text style={s.emptyMini}>No finished jobs yet this month.</Text>
                  ) : (
                    <View style={s.donutRow}>
                      <View style={s.donutWrap}>
                        <Donut
                          data={[
                            { value: analytics.completion.done, color: dash.emerald },
                            { value: analytics.completion.cancelled, color: dash.rose }
                          ]}
                          size={138}
                          thickness={20}
                        />
                        <View style={s.donutCenter}>
                          <Text style={s.donutCenterValue}>{analytics.completion.rate}%</Text>
                          <Text style={s.donutCenterLabel}>done</Text>
                        </View>
                      </View>
                      <View style={s.legend}>
                        <View style={s.legendRow}>
                          <View style={[s.legendDot, { backgroundColor: dash.emerald }]} />
                          <Text style={s.legendName}>Completed</Text>
                          <Text style={s.legendPct}>{analytics.completion.done}</Text>
                        </View>
                        <View style={s.legendRow}>
                          <View style={[s.legendDot, { backgroundColor: dash.rose }]} />
                          <Text style={s.legendName}>Cancelled</Text>
                          <Text style={s.legendPct}>{analytics.completion.cancelled}</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>

                {/* Top barbers */}
                <View style={[s.card, s.gridCard]}>
                  <Text style={s.cardHeading}>Top barbers · revenue</Text>
                  {analytics.topBarbers.length === 0 ? (
                    <Text style={s.emptyMini}>No cuts yet this month.</Text>
                  ) : (
                    (() => {
                      const max = Math.max(1, ...analytics.topBarbers.map((x) => x.revenue_sen));
                      return analytics.topBarbers.map((b, i) => (
                        <RankBar
                          key={b.staff_id}
                          rank={i + 1}
                          label={b.name}
                          valueLabel={`${formatRM(b.revenue_sen)} · ${b.cuts}`}
                          pct={(b.revenue_sen / max) * 100}
                          color={chartPalette[i % chartPalette.length]}
                        />
                      ));
                    })()
                  )}
                </View>

                {/* Discount usage */}
                <View style={[s.card, s.gridCard]}>
                  <Text style={s.cardHeading}>Discount usage · this month</Text>
                  {analytics.cuts === 0 ? (
                    <Text style={s.emptyMini}>No cuts yet this month.</Text>
                  ) : (
                    <View style={s.donutRow}>
                      <View style={s.donutWrap}>
                        <Donut
                          data={[
                            { value: analytics.discount.withCode, color: dash.amber },
                            { value: analytics.discount.full, color: '#CBD5E1' }
                          ]}
                          size={138}
                          thickness={20}
                        />
                        <View style={s.donutCenter}>
                          <Text style={s.donutCenterValue}>{analytics.discount.rate}%</Text>
                          <Text style={s.donutCenterLabel}>w/ code</Text>
                        </View>
                      </View>
                      <View style={s.legend}>
                        <View style={s.legendRow}>
                          <View style={[s.legendDot, { backgroundColor: dash.amber }]} />
                          <Text style={s.legendName}>With discount</Text>
                          <Text style={s.legendPct}>{analytics.discount.withCode}</Text>
                        </View>
                        <View style={s.legendRow}>
                          <View style={[s.legendDot, { backgroundColor: '#CBD5E1' }]} />
                          <Text style={s.legendName}>Full price</Text>
                          <Text style={s.legendPct}>{analytics.discount.full}</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            </>
          )}

          {/* Per-barber today */}
          <Text style={s.sectionLabel}>PER BARBER · TODAY</Text>
          {summary.perBarber.length === 0 ? (
            <View style={s.card}>
              <Text style={s.emptyMini}>No barbers on record.</Text>
            </View>
          ) : (
            summary.perBarber.map((b) => (
              <View key={b.staff_id} style={s.barberCard}>
                <View style={s.barberHeader}>
                  <View style={s.barberIdent}>
                    <View style={[s.avatar, b.onShift && s.avatarOn]}>
                      <Text style={[s.avatarText, b.onShift && s.avatarTextOn]}>
                        {b.name.trim().charAt(0).toUpperCase() || '?'}
                      </Text>
                    </View>
                    <Text style={s.bName} numberOfLines={1}>
                      {b.name}
                    </Text>
                  </View>
                  {b.onShift ? (
                    <View style={s.onShiftPill}>
                      <View style={s.liveDot} />
                      <Text style={s.onShiftText}>On shift</Text>
                    </View>
                  ) : (
                    <Text style={s.offText}>Off</Text>
                  )}
                </View>
                <View style={s.bStatsRow}>
                  <View style={s.bStat}>
                    <Text style={s.bStatValue}>{b.cuts}</Text>
                    <Text style={s.bStatLabel}>Cuts</Text>
                  </View>
                  <View style={s.bStat}>
                    <Text style={s.bStatValue}>{b.inQueue}</Text>
                    <Text style={s.bStatLabel}>In queue</Text>
                  </View>
                  <View style={s.bStat}>
                    <Text style={[s.bStatValue, { color: dash.primary }]}>
                      {formatRM(b.revenue_sen)}
                    </Text>
                    <Text style={s.bStatLabel}>Revenue</Text>
                  </View>
                </View>
              </View>
            ))
          )}

          <View style={s.liveFooter}>
            <View style={s.liveDot} />
            <Text style={s.liveFooterText}>Updates live</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: dash.bg },
  scrollContent: { padding: space.lg, gap: space.sm },

  kicker: { fontSize: 11, fontWeight: '700', color: dash.subtle, letterSpacing: 1.2 },
  h1: { fontSize: 24, fontWeight: '800', color: dash.text, letterSpacing: -0.4, marginTop: 2 },
  dateText: { fontSize: 13, color: dash.muted, marginTop: 2 },

  // Feature card
  feature: {
    borderRadius: 18,
    backgroundColor: dash.primary,
    overflow: 'hidden',
    marginBottom: space.xs,
    shadowColor: dash.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6
  },
  featContent: { padding: space.lg },
  featTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  featKicker: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4
  },
  featLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999
  },
  featDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  featLiveText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  featValue: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1,
    marginTop: 8,
    marginBottom: space.md
  },
  featBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  featDelta: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999
  },
  featDeltaText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  featSpark: { width: 120, height: 40 },

  // KPI tiles
  tileRow: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1,
    backgroundColor: dash.card,
    borderWidth: 1,
    borderColor: dash.border,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    gap: 6
  },
  tileIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tileValue: { fontSize: 18, fontWeight: '800', color: dash.text, letterSpacing: -0.4 },
  tileLabel: {
    fontSize: 10,
    color: dash.muted,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase'
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: dash.subtle,
    letterSpacing: 0.8,
    marginTop: space.md,
    marginBottom: 4
  },

  // Cards
  card: {
    backgroundColor: dash.card,
    borderWidth: 1,
    borderColor: dash.border,
    borderRadius: radius.lg,
    padding: space.lg
  },
  // Responsive 2-up chart grid: 2 per row on wide screens, 1 per row when narrow.
  chartsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  gridCard: { flexBasis: '48%', flexGrow: 1, minWidth: 280 },
  cardHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: dash.text,
    letterSpacing: -0.2,
    marginBottom: space.md
  },
  cardHeadHint: { fontSize: 10, color: dash.subtle, fontWeight: '700', letterSpacing: 0.5 },
  emptyMini: { fontSize: 12, color: dash.muted, paddingVertical: 4 },

  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: 4 },
  axisLabel: { fontSize: 10, color: dash.subtle, fontWeight: '600', flex: 1, textAlign: 'center' },
  axisLabelSm: { fontSize: 8, color: dash.subtle, fontWeight: '600', flex: 1, textAlign: 'center' },

  // Donut
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  donutWrap: { width: 138, height: 138, alignItems: 'center', justifyContent: 'center' },
  donutCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  donutCenterValue: { fontSize: 26, fontWeight: '800', color: dash.text, letterSpacing: -0.5 },
  donutCenterLabel: {
    fontSize: 10,
    color: dash.muted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: -2
  },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendName: { flex: 1, fontSize: 13, color: dash.text, fontWeight: '600' },
  legendPct: { fontSize: 13, color: dash.muted, fontWeight: '700' },

  // Ranked bars
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  rankChip: { width: 22, height: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 11, fontWeight: '800' },
  barTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 5
  },
  barLabel: { fontSize: 13, color: dash.text, fontWeight: '600', flexShrink: 1, paddingRight: 8 },
  barValue: { fontSize: 12, color: dash.muted, fontWeight: '700' },
  barTrack: { height: 9, borderRadius: 999, backgroundColor: dash.track, overflow: 'hidden' },
  barFill: { height: 9, borderRadius: 999 },

  // Per-barber today
  barberCard: {
    backgroundColor: dash.card,
    borderWidth: 1,
    borderColor: dash.border,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm
  },
  barberHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barberIdent: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: dash.track,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarOn: { backgroundColor: dash.primary },
  avatarText: { fontSize: 15, fontWeight: '800', color: dash.muted },
  avatarTextOn: { color: '#fff' },
  bName: {
    fontSize: 15,
    fontWeight: '700',
    color: dash.text,
    letterSpacing: -0.1,
    flexShrink: 1,
    paddingRight: 8
  },
  onShiftPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: dash.emeraldSoft,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: dash.emerald },
  onShiftText: { fontSize: 11, fontWeight: '700', color: dash.emerald, letterSpacing: 0.3 },
  offText: { fontSize: 11, fontWeight: '600', color: dash.subtle, letterSpacing: 0.3 },

  bStatsRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: dash.border, paddingTop: space.sm },
  bStat: { flex: 1, gap: 2 },
  bStatValue: { fontSize: 17, fontWeight: '800', color: dash.text, letterSpacing: -0.3 },
  bStatLabel: {
    fontSize: 10,
    color: dash.muted,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase'
  },

  liveFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
  liveFooterText: { fontSize: 11, color: dash.subtle, fontStyle: 'italic' }
});
