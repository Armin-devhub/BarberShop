import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import {
  formatRM,
  type Earning,
  type EmploymentType,
  type SalaryPayment,
  type ShopSettings
} from '@/lib/types';
import { cardShadow, colors, pageHeader, radius, space } from '@/lib/theme';

type Tab = 'totals' | 'earnings' | 'shifts';

interface EarningRow extends Earning {
  staff?: { name: string } | null;
  queue_entries?: {
    customer_name: string | null;
    queue_number: number | null;
    services?: { name: string } | null;
  } | null;
}

interface ShiftRow {
  id: string;
  staff_id: string;
  started_at: string;
  ended_at: string | null;
  staff?: { name: string } | null;
}

interface BarberTotal {
  staff_id: string;
  name: string;
  employment_type: EmploymentType;
  commission_sen: number;
  base_salary_sen: number;
  total_sen: number;
  paid: boolean;
}

function monthBounds(year: number, month: number): { start: string; end: string } {
  // month is 1-based.
  return {
    start: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, month, 1)).toISOString()
  };
}

function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function shiftPeriod(year: number, month: number, delta: number): { year: number; month: number } {
  // month is 1-based; supports any delta.
  const totalMonths = year * 12 + (month - 1) + delta;
  return {
    year: Math.floor(totalMonths / 12),
    month: (totalMonths % 12) + 1
  };
}

function thisPeriod(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export default function AdminPay() {
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  // Editable copies, kept as strings so the user can clear / type freely.
  const [baseText, setBaseText] = useState('');
  const [ftPctText, setFtPctText] = useState('');
  const [coPctText, setCoPctText] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [tab, setTab] = useState<Tab>('totals');
  const [earnings, setEarnings] = useState<EarningRow[] | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [totals, setTotals] = useState<BarberTotal[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [period, setPeriod] = useState(thisPeriod());

  const loadSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('shop_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    if (data) {
      setSettings(data as ShopSettings);
      setBaseText(((data.full_time_base_salary_sen as number) / 100).toFixed(2));
      setFtPctText(String(data.full_time_commission_percent));
      setCoPctText(String(data.commission_only_percent));
    }
  }, []);

  const loadEarnings = useCallback(async () => {
    const { data } = await supabase
      .from('earnings')
      .select(
        `*,
         staff:staff_id ( name ),
         queue_entries:queue_entry_id (
           customer_name, queue_number,
           services:service_id ( name )
         )`
      )
      .order('earned_at', { ascending: false })
      .limit(100);
    setEarnings((data as EarningRow[]) ?? []);
  }, []);

  const loadShifts = useCallback(async () => {
    const { data } = await supabase
      .from('shifts')
      .select('*, staff:staff_id ( name )')
      .order('started_at', { ascending: false })
      .limit(100);
    setShifts((data as ShiftRow[]) ?? []);
  }, []);

  const loadTotals = useCallback(
    async (currentSettings: ShopSettings, currentPeriod: { year: number; month: number }) => {
      const { start, end } = monthBounds(currentPeriod.year, currentPeriod.month);
      const [{ data: barbers }, { data: monthEarnings }, { data: payments }] = await Promise.all([
        supabase
          .from('staff')
          .select('id, name, employment_type')
          .eq('active', true)
          .eq('role', 'barber')
          .order('name'),
        supabase
          .from('earnings')
          .select('staff_id, amount_sen')
          .gte('earned_at', start)
          .lt('earned_at', end),
        supabase
          .from('salary_payments')
          .select('staff_id, paid')
          .eq('period_year', currentPeriod.year)
          .eq('period_month', currentPeriod.month)
      ]);

      const sumByStaff = new Map<string, number>();
      for (const e of (monthEarnings ?? []) as { staff_id: string; amount_sen: number }[]) {
        sumByStaff.set(e.staff_id, (sumByStaff.get(e.staff_id) ?? 0) + e.amount_sen);
      }

      const paidByStaff = new Set<string>(
        ((payments ?? []) as SalaryPayment[])
          .filter((p) => p.paid)
          .map((p) => p.staff_id)
      );

      setTotals(
        (barbers ?? []).map(
          (b: { id: string; name: string; employment_type: EmploymentType }) => {
            const commission = sumByStaff.get(b.id) ?? 0;
            const salary =
              b.employment_type === 'full_time'
                ? currentSettings.full_time_base_salary_sen
                : 0;
            return {
              staff_id: b.id,
              name: b.name,
              employment_type: b.employment_type,
              commission_sen: commission,
              base_salary_sen: salary,
              total_sen: commission + salary,
              paid: paidByStaff.has(b.id)
            };
          }
        )
      );
    },
    []
  );

  useEffect(() => {
    loadSettings();
    loadEarnings();
    loadShifts();
  }, [loadSettings, loadEarnings, loadShifts]);

  // Recompute totals whenever settings or the selected period changes.
  useEffect(() => {
    if (settings) loadTotals(settings, period);
  }, [settings, period, loadTotals]);

  async function togglePaid(b: BarberTotal) {
    if (b.paid) {
      const { error } = await supabase
        .from('salary_payments')
        .delete()
        .eq('staff_id', b.staff_id)
        .eq('period_year', period.year)
        .eq('period_month', period.month);
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
    } else {
      const { error } = await supabase.from('salary_payments').upsert({
        staff_id: b.staff_id,
        period_year: period.year,
        period_month: period.month,
        paid: true,
        paid_at: new Date().toISOString(),
        paid_amount_sen: b.total_sen
      });
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
    }
    if (settings) loadTotals(settings, period);
  }

  async function handleSaveSettings() {
    const base = parseFloat(baseText.replace(',', '.'));
    const ftPct = parseInt(ftPctText, 10);
    const coPct = parseInt(coPctText, 10);

    if (!Number.isFinite(base) || base < 0) {
      Alert.alert('Invalid base salary', 'Enter a non-negative RM amount.');
      return;
    }
    if (!Number.isFinite(ftPct) || ftPct < 0 || ftPct > 100) {
      Alert.alert('Invalid percent', 'Full-time commission must be 0–100.');
      return;
    }
    if (!Number.isFinite(coPct) || coPct < 0 || coPct > 100) {
      Alert.alert('Invalid percent', 'Commission-only must be 0–100.');
      return;
    }

    setSavingSettings(true);
    const { error } = await supabase
      .from('shop_settings')
      .update({
        full_time_base_salary_sen: Math.round(base * 100),
        full_time_commission_percent: ftPct,
        commission_only_percent: coPct,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1);
    setSavingSettings(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    Alert.alert('Saved', 'Pay settings updated. Future commissions use the new rates.');
    setShowSettings(false);
    loadSettings();
  }

  async function refreshAll() {
    setRefreshing(true);
    await Promise.all([
      loadSettings(),
      loadEarnings(),
      loadShifts(),
      settings ? loadTotals(settings, period) : Promise.resolve()
    ]);
    setRefreshing(false);
  }

  if (!settings) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  return (
    <>
    <ScrollView
      style={s.flex}
      contentContainerStyle={s.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
    >
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={pageHeader.subtitle}>Pay</Text>
          <Text style={pageHeader.title}>Payroll</Text>
        </View>
        <Pressable
          style={s.settingsBtn}
          onPress={() => setShowSettings(true)}
          accessibilityLabel="Open pay settings"
          hitSlop={8}
        >
          <Ionicons name="settings-outline" size={20} color={colors.text} />
        </Pressable>
      </View>

      <View style={s.segment}>
        {(['totals', 'earnings', 'shifts'] as Tab[]).map((t) => {
          const on = tab === t;
          const label = t === 'totals' ? 'Totals' : t === 'earnings' ? 'Earnings' : 'Shifts';
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[s.segmentBtn, on && s.segmentBtnOn]}
            >
              <Text style={[s.segmentBtnText, on && s.segmentBtnTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'totals' && (
        <>
          <View style={s.monthBar}>
            <Pressable
              hitSlop={8}
              onPress={() => setPeriod((p) => shiftPeriod(p.year, p.month, -1))}
              style={s.monthArrow}
            >
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </Pressable>
            <Text style={s.monthLabel}>{monthLabel(period.year, period.month)}</Text>
            <Pressable
              hitSlop={8}
              onPress={() => setPeriod((p) => shiftPeriod(p.year, p.month, 1))}
              style={s.monthArrow}
            >
              <Ionicons name="chevron-forward" size={20} color={colors.text} />
            </Pressable>
          </View>

          {totals === null && <ActivityIndicator color={colors.muted} />}
          {totals && totals.length === 0 && (
            <Text style={s.muted}>No active barbers yet.</Text>
          )}
          {totals?.map((t) => (
            <View key={t.staff_id} style={s.totalCard}>
              <View style={s.totalHeader}>
                <Text style={s.totalName}>{t.name}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Text style={s.totalPill}>
                    {t.employment_type === 'full_time' ? 'Full-time' : 'Commission'}
                  </Text>
                  <Pressable
                    onPress={() => togglePaid(t)}
                    style={[s.statusPill, t.paid ? s.statusPaid : s.statusDue]}
                  >
                    <Text style={[s.statusPillText, t.paid ? s.statusPaidText : s.statusDueText]}>
                      {t.paid ? 'Paid' : 'Due'}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Commission</Text>
                <Text style={s.totalValue}>{formatRM(t.commission_sen)}</Text>
              </View>
              {t.employment_type === 'full_time' && (
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Base salary</Text>
                  <Text style={s.totalValue}>{formatRM(t.base_salary_sen)}</Text>
                </View>
              )}
              <View style={[s.totalRow, s.totalRowGrand]}>
                <Text style={s.totalLabelGrand}>Total</Text>
                <Text style={s.totalValueGrand}>{formatRM(t.total_sen)}</Text>
              </View>
            </View>
          ))}
        </>
      )}

      {tab === 'earnings' && (
        <>
          {earnings === null && <ActivityIndicator color={colors.muted} />}
          {earnings && earnings.length === 0 && (
            <Text style={s.muted}>No commissions yet — earnings appear when staff finish a customer.</Text>
          )}
          {earnings?.map((e) => (
            <View key={e.id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{e.staff?.name ?? '—'}</Text>
                <Text style={s.rowMeta}>
                  {e.queue_entries?.services?.name ?? 'Service'}
                  {e.queue_entries?.queue_number ? ` · #${e.queue_entries.queue_number}` : ''}
                  {e.percent_applied != null ? ` · ${e.percent_applied}%` : ''}
                </Text>
                <Text style={s.rowDate}>{new Date(e.earned_at).toLocaleString()}</Text>
              </View>
              <Text style={s.amount}>{formatRM(e.amount_sen)}</Text>
            </View>
          ))}
        </>
      )}

      {tab === 'shifts' && (
        <>
          {shifts === null && <ActivityIndicator color={colors.muted} />}
          {shifts && shifts.length === 0 && (
            <Text style={s.muted}>No shifts recorded yet.</Text>
          )}
          {shifts?.map((sh) => {
            const start = new Date(sh.started_at);
            const end = sh.ended_at ? new Date(sh.ended_at) : null;
            const minutes = end
              ? Math.round((end.getTime() - start.getTime()) / 60000)
              : Math.round((Date.now() - start.getTime()) / 60000);
            const duration =
              minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
            return (
              <View key={sh.id} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{sh.staff?.name ?? '—'}</Text>
                  <Text style={s.rowMeta}>
                    {start.toLocaleString()} → {end ? end.toLocaleString() : 'on shift'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.amount}>{duration}</Text>
                  {!end && <Text style={s.activeTag}>active</Text>}
                </View>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>

    <Modal
      visible={showSettings}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={() => setShowSettings(false)}
    >
      <SafeAreaView style={s.modalContainer} edges={['top']}>
        <View style={s.modalHeader}>
          <Pressable onPress={() => setShowSettings(false)}>
            <Text style={s.modalCancel}>Close</Text>
          </Pressable>
          <Text style={s.modalTitle}>Pay settings</Text>
          <Pressable onPress={handleSaveSettings} disabled={savingSettings}>
            <Text style={s.modalSave}>{savingSettings ? '...' : 'Save'}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={s.modalBody}>
          <Text style={s.label}>Full-time base salary (RM, monthly)</Text>
          <TextInput
            style={s.input}
            value={baseText}
            onChangeText={setBaseText}
            keyboardType="decimal-pad"
            placeholder="1700.00"
            placeholderTextColor={colors.subtle}
          />

          <Text style={s.label}>Full-time commission %</Text>
          <TextInput
            style={s.input}
            value={ftPctText}
            onChangeText={setFtPctText}
            keyboardType="number-pad"
            placeholder="10"
            placeholderTextColor={colors.subtle}
          />

          <Text style={s.label}>Commission-only %</Text>
          <TextInput
            style={s.input}
            value={coPctText}
            onChangeText={setCoPctText}
            keyboardType="number-pad"
            placeholder="50"
            placeholderTextColor={colors.subtle}
          />

          <Text style={s.helpText}>
            Changes only affect future commissions. Past earnings stay at the rate that
            was active when they were earned.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.muted, textAlign: 'center', marginTop: space.lg, fontSize: 13 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
    marginBottom: space.md,
    ...cardShadow
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },

  label: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginTop: space.xs
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text
  },
  primary: {
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: space.sm
  },
  primaryText: {
    color: colors.primaryText,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2
  },
  disabled: { opacity: 0.45 },

  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    padding: 2,
    marginBottom: space.sm
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    alignItems: 'center'
  },
  segmentBtnOn: { backgroundColor: colors.surfaceAlt },
  segmentBtnText: {
    color: colors.muted,
    fontWeight: '500',
    fontSize: 13,
    letterSpacing: 0.2
  },
  segmentBtnTextOn: { color: colors.text, fontWeight: '600' },

  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    ...cardShadow
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.1
  },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  rowDate: { fontSize: 11, color: colors.subtle, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '700', color: colors.text },
  activeTag: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    color: colors.ok,
    letterSpacing: 0.2
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.4,
    marginBottom: space.sm
  },
  totalCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
    ...cardShadow
  },
  totalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xs
  },
  totalName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.1
  },
  totalPill: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
    letterSpacing: 0.3
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2
  },
  totalRowGrand: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: space.xs,
    marginTop: space.xs
  },
  totalLabel: { fontSize: 12, color: colors.muted, letterSpacing: 0.2 },
  totalValue: { fontSize: 13, color: colors.text, fontWeight: '600' },
  totalLabelGrand: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.3
  },
  totalValueGrand: { fontSize: 18, fontWeight: '700', color: colors.text },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow
  },

  modalContainer: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  modalCancel: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  modalSave: { color: colors.text, fontSize: 14, fontWeight: '700' },
  modalBody: { padding: space.lg, gap: space.md },
  helpText: {
    fontSize: 12,
    color: colors.muted,
    marginTop: space.sm,
    lineHeight: 18
  },

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
    marginBottom: space.sm,
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
  monthLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: 0.2
  },

  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1
  },
  statusPaid: {
    backgroundColor: colors.ok,
    borderColor: colors.ok
  },
  statusDue: {
    backgroundColor: colors.warnSoft,
    borderColor: colors.warn
  },
  statusPillText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  statusPaidText: { color: '#fff' },
  statusDueText: { color: colors.warn }
});
