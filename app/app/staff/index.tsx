import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import type { Staff } from '@/lib/types';
import { colors, radius, space, cardShadow } from '@/lib/theme';

interface BarberRow extends Staff {
  shift_started_at: string | null;
  waiting_count: number;
}

/**
 * Staff picker — anonymous. Anyone with the tablet picks a barber to operate.
 * An "Admin" header link lets the owner jump to admin mode (requires login).
 */
export default function StaffPicker() {
  const router = useRouter();
  const [rows, setRows] = useState<BarberRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: staff } = await supabase
      .from('staff')
      .select('*')
      .eq('active', true)
      .eq('role', 'barber')
      .order('name');

    if (!staff || staff.length === 0) {
      setRows([]);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const ids = staff.map((s) => s.id);

    const [{ data: openShifts }, { data: queueRows }] = await Promise.all([
      supabase
        .from('shifts')
        .select('staff_id, started_at')
        .is('ended_at', null)
        .in('staff_id', ids),
      supabase
        .from('queue_entries')
        .select('staff_id')
        .eq('queue_date', today)
        .in('status', ['waiting', 'in_progress'])
        .in('staff_id', ids)
    ]);

    const shiftByStaff = new Map<string, string>(
      (openShifts ?? []).map((sh: { staff_id: string; started_at: string }) => [
        sh.staff_id,
        sh.started_at
      ])
    );
    const waitingByStaff = new Map<string, number>();
    for (const row of (queueRows ?? []) as { staff_id: string }[]) {
      waitingByStaff.set(row.staff_id, (waitingByStaff.get(row.staff_id) ?? 0) + 1);
    }

    setRows(
      (staff as Staff[]).map((s) => ({
        ...s,
        shift_started_at: shiftByStaff.get(s.id) ?? null,
        waiting_count: waitingByStaff.get(s.id) ?? 0
      }))
    );
  }, []);

  useEffect(() => {
    load();

    const channel = supabase
      .channel(`staff-picker-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries' }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  function HeaderRight() {
    return (
      <Pressable onPress={() => router.push('/admin')} hitSlop={8} style={s.headerBtn}>
        <Text style={s.headerBtnText}>Admin ›</Text>
      </Pressable>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={s.scrollContent}
      style={s.flex}
      refreshControl={
        <RefreshControl
          tintColor={colors.muted}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Stack.Screen options={{ title: 'Novyx', headerRight: HeaderRight }} />

      <Text style={s.title}>Who's on shift?</Text>
      <View style={s.liveRow}>
        <View style={s.liveDot} />
        <Text style={s.liveText}>Live · updates automatically</Text>
      </View>

      {rows === null && <ActivityIndicator color={colors.muted} style={{ marginTop: space.lg }} />}
      {rows && rows.length === 0 && (
        <Text style={s.muted}>No active staff yet. Add some in the Staff tab.</Text>
      )}
      {rows?.map((r, i) => {
        const onShift = !!r.shift_started_at;
        const isFree = onShift && r.waiting_count === 0;
        return (
          <Pressable
            key={r.id}
            onPress={() => router.push(`/staff/${r.id}`)}
            style={onShift ? s.cardOn : s.cardOff}
          >
            <Text style={onShift ? s.numeral : s.numeralOff}>{String(i + 1).padStart(2, '0')}</Text>
            <View style={{ flex: 1, marginLeft: space.md }}>
              <Text style={onShift ? s.name : s.nameOff}>{r.name}</Text>
              <View style={s.statusRow}>
                <View style={[s.dot, onShift ? (isFree ? s.dotOk : s.dotWarn) : s.dotOff]} />
                <Text style={onShift ? (isFree ? s.statusOk : s.statusWarn) : s.statusOff}>
                  {onShift
                    ? isFree
                      ? 'On shift · Free now'
                      : `On shift · ${r.waiting_count} in queue`
                    : 'Off shift'}
                </Text>
              </View>
            </View>
            <View style={onShift ? s.ctaPrimary : s.ctaSecondary}>
              <Text style={onShift ? s.ctaPrimaryText : s.ctaSecondaryText}>
                {onShift ? 'Open queue →' : 'Clock in →'}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },

  headerBtn: { paddingHorizontal: space.sm, paddingVertical: 4 },
  headerBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2
  },

  title: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: space.sm
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok },
  liveText: { color: colors.muted, fontSize: 12, fontWeight: '500', letterSpacing: 0.2 },

  muted: { color: colors.muted, textAlign: 'center', marginTop: space.lg, fontSize: 14 },

  cardOn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.ok,
    borderRadius: radius.md,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...cardShadow
  },
  cardOff: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center'
  },

  numeral: { fontSize: 15, fontWeight: '700', color: colors.subtle, width: 26 },
  numeralOff: { fontSize: 15, fontWeight: '700', color: colors.subtle, width: 26 },
  name: { fontSize: 17, fontWeight: '600', color: colors.text, letterSpacing: -0.2 },
  nameOff: { fontSize: 17, fontWeight: '600', color: colors.muted, letterSpacing: -0.2 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotOk: { backgroundColor: colors.ok },
  dotWarn: { backgroundColor: colors.warn },
  dotOff: { backgroundColor: colors.subtle },
  statusOk: { color: colors.ok, fontSize: 12, fontWeight: '500', letterSpacing: 0.2 },
  statusWarn: { color: colors.warn, fontSize: 12, fontWeight: '500', letterSpacing: 0.2 },
  statusOff: { color: colors.muted, fontSize: 12, fontWeight: '500', letterSpacing: 0.2 },

  ctaPrimary: {
    backgroundColor: colors.ok,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.sm
  },
  ctaPrimaryText: {
    color: colors.primaryText,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2
  },
  ctaSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.sm
  },
  ctaSecondaryText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2
  }
});
