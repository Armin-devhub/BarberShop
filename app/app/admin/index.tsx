import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { fetchTodaySummary, type TodaySummary } from '@/lib/today';
import { formatRM } from '@/lib/types';
import { cardShadow, colors, pageHeader, radius, space } from '@/lib/theme';

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState<TodaySummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSummary(await fetchTodaySummary());
    } catch {
      // Leave the previous summary in place on a transient error.
    }
  }, []);

  useEffect(() => {
    load();
    // Keep the dashboard live as customers are served / barbers clock in.
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

  return (
    <ScrollView
      style={s.flex}
      contentContainerStyle={s.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={pageHeader.wrap}>
        <Text style={pageHeader.subtitle}>Dashboard</Text>
        <Text style={pageHeader.title}>Today</Text>
        <Text style={s.dateText}>{todayLabel()}</Text>
      </View>

      {summary === null ? (
        <ActivityIndicator color={colors.muted} style={{ marginTop: space.lg }} />
      ) : (
        <>
          {/* Headline stats */}
          <View style={s.grid}>
            <View style={s.statCard}>
              <Text style={s.statLabel}>Revenue today</Text>
              <Text style={s.statValue}>{formatRM(summary.revenue_sen)}</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statLabel}>Customers served</Text>
              <Text style={s.statValue}>{summary.customersServed.toLocaleString()}</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statLabel}>In queue now</Text>
              <Text style={s.statValue}>{summary.inQueue.toLocaleString()}</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statLabel}>Barbers on shift</Text>
              <Text style={s.statValue}>{summary.onShiftCount.toLocaleString()}</Text>
            </View>
          </View>

          {/* Per-barber today */}
          <Text style={s.sectionLabel}>Per barber · today</Text>
          {summary.perBarber.length === 0 ? (
            <View style={s.card}>
              <Text style={s.empty}>No barbers on record.</Text>
            </View>
          ) : (
            summary.perBarber.map((b) => (
              <View key={b.staff_id} style={s.barberCard}>
                <View style={s.barberHeader}>
                  <Text style={s.bName} numberOfLines={1}>
                    {b.name}
                  </Text>
                  {b.onShift ? (
                    <View style={s.onShiftPill}>
                      <View style={s.liveDot} />
                      <Text style={s.onShiftText}>On shift</Text>
                    </View>
                  ) : (
                    <Text style={s.offText}>Off</Text>
                  )}
                </View>
                <View style={s.bRow}>
                  <Text style={s.bRowLabel}>Cuts</Text>
                  <Text style={s.bRowValue}>{b.cuts}</Text>
                </View>
                <View style={s.bRow}>
                  <Text style={s.bRowLabel}>In queue</Text>
                  <Text style={s.bRowValue}>{b.inQueue}</Text>
                </View>
                <View style={[s.bRow, s.bRowGrand]}>
                  <Text style={s.bRowLabelGrand}>Revenue</Text>
                  <Text style={s.bRowValueGrand}>{formatRM(b.revenue_sen)}</Text>
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
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },
  dateText: { fontSize: 13, color: colors.muted, marginTop: 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  statCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    ...cardShadow
  },
  statLabel: {
    fontSize: 10,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600'
  },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 4 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.4,
    marginTop: space.md,
    marginBottom: 2
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    ...cardShadow
  },
  empty: { fontSize: 13, color: colors.muted },

  barberCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: 3,
    ...cardShadow
  },
  barberHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  bName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.1,
    flexShrink: 1,
    paddingRight: 8
  },
  onShiftPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok },
  onShiftText: { fontSize: 11, fontWeight: '600', color: colors.ok, letterSpacing: 0.3 },
  offText: { fontSize: 11, fontWeight: '600', color: colors.subtle, letterSpacing: 0.3 },

  bRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2
  },
  bRowLabel: { fontSize: 12, color: colors.muted, letterSpacing: 0.2 },
  bRowValue: { fontSize: 13, color: colors.text, fontWeight: '600' },
  bRowGrand: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: space.xs,
    marginTop: space.xs
  },
  bRowLabelGrand: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.3 },
  bRowValueGrand: { fontSize: 17, fontWeight: '700', color: colors.text },

  liveFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.sm
  },
  liveFooterText: { fontSize: 11, color: colors.subtle, fontStyle: 'italic' }
});
