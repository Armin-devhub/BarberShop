import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
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

type Tab = 'totals' | 'earnings';

interface EarningRow extends Earning {
  staff?: { name: string } | null;
  queue_entries?: {
    customer_name: string | null;
    queue_number: number | null;
    services?: { name: string } | null;
  } | null;
}

interface BarberLite {
  id: string;
  name: string;
  employment_type: EmploymentType;
}

interface BarberTotal {
  staff_id: string;
  name: string;
  employment_type: EmploymentType;
  commission_sen: number;
  base_salary_sen: number; // OWED base for this month (override / worked-standard / 0)
  standard_base_sen: number; // this barber's standard monthly base (full-time)
  base_overridden: boolean; // true if this month's base is a manual override
  revenue_sen: number; // 100% of what customers paid for this barber's cuts
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
  const [barbers, setBarbers] = useState<BarberLite[]>([]);
  const [earningsBarber, setEarningsBarber] = useState<string | 'all'>('all');
  const [totals, setTotals] = useState<BarberTotal[] | null>(null);
  // Shop-wide month summary (all barbers, including any since-deactivated).
  const [summary, setSummary] = useState<{ revenue: number; commission: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [period, setPeriod] = useState(thisPeriod());

  // Per-barber base salary editor (month override / standard).
  const [salaryTarget, setSalaryTarget] = useState<BarberTotal | null>(null);
  const [salaryText, setSalaryText] = useState('');
  const [salaryBusy, setSalaryBusy] = useState(false);

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

  const loadBarbers = useCallback(async () => {
    const { data } = await supabase
      .from('staff')
      .select('id, name, employment_type')
      .eq('active', true)
      .eq('role', 'barber')
      .order('name');
    setBarbers((data as BarberLite[]) ?? []);
  }, []);

  const loadEarnings = useCallback(
    async (
      currentPeriod: { year: number; month: number },
      barberId: string | 'all'
    ) => {
      setEarnings(null);
      const { start, end } = monthBounds(currentPeriod.year, currentPeriod.month);
      let q = supabase
        .from('earnings')
        .select(
          `*,
           staff:staff_id ( name ),
           queue_entries:queue_entry_id (
             customer_name, queue_number,
             services:service_id ( name )
           )`
        )
        .gte('earned_at', start)
        .lt('earned_at', end)
        .order('earned_at', { ascending: false });
      if (barberId !== 'all') q = q.eq('staff_id', barberId);
      const { data } = await q;
      setEarnings((data as EarningRow[]) ?? []);
    },
    []
  );

  const loadTotals = useCallback(
    async (currentSettings: ShopSettings, currentPeriod: { year: number; month: number }) => {
      const { start, end } = monthBounds(currentPeriod.year, currentPeriod.month);
      const startDate = start.slice(0, 10);
      const endDate = end.slice(0, 10);
      const [
        { data: barberRows },
        { data: monthEarnings },
        { data: payments },
        { data: doneEntries },
        { data: monthShifts },
        { data: monthOverrides }
      ] = await Promise.all([
        supabase
          .from('staff')
          .select('id, name, employment_type, base_salary_sen')
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
          .eq('period_month', currentPeriod.month),
        supabase
          .from('queue_entries')
          .select('staff_id, final_price_sen')
          .eq('status', 'done')
          .gte('queue_date', startDate)
          .lt('queue_date', endDate),
        supabase
          .from('shifts')
          .select('staff_id')
          .gte('started_at', start)
          .lt('started_at', end),
        supabase
          .from('salary_overrides')
          .select('staff_id, base_sen')
          .eq('period_year', currentPeriod.year)
          .eq('period_month', currentPeriod.month)
      ]);

      const sumByStaff = new Map<string, number>();
      for (const e of (monthEarnings ?? []) as { staff_id: string; amount_sen: number }[]) {
        sumByStaff.set(e.staff_id, (sumByStaff.get(e.staff_id) ?? 0) + e.amount_sen);
      }

      const revenueByStaff = new Map<string, number>();
      let revenueAll = 0;
      for (const q of (doneEntries ?? []) as { staff_id: string; final_price_sen: number }[]) {
        revenueByStaff.set(
          q.staff_id,
          (revenueByStaff.get(q.staff_id) ?? 0) + (q.final_price_sen ?? 0)
        );
        revenueAll += q.final_price_sen ?? 0;
      }
      const commissionAll = ((monthEarnings ?? []) as { amount_sen: number }[]).reduce(
        (acc, e) => acc + e.amount_sen,
        0
      );
      setSummary({ revenue: revenueAll, commission: commissionAll });

      const paidByStaff = new Set<string>(
        ((payments ?? []) as SalaryPayment[])
          .filter((p) => p.paid)
          .map((p) => p.staff_id)
      );

      // Worked this month = started >=1 shift. Overrides win over the standard.
      const workedSet = new Set(
        ((monthShifts ?? []) as { staff_id: string }[]).map((s) => s.staff_id)
      );
      const overrideByStaff = new Map(
        ((monthOverrides ?? []) as { staff_id: string; base_sen: number }[]).map((o) => [
          o.staff_id,
          o.base_sen
        ])
      );

      setTotals(
        (barberRows ?? []).map(
          (b: {
            id: string;
            name: string;
            employment_type: EmploymentType;
            base_salary_sen: number | null;
          }) => {
            const commission = sumByStaff.get(b.id) ?? 0;
            const isFullTime = b.employment_type === 'full_time';
            const standard = b.base_salary_sen ?? currentSettings.full_time_base_salary_sen;
            const overridden = overrideByStaff.has(b.id);
            const owedBase = !isFullTime
              ? 0
              : overridden
                ? overrideByStaff.get(b.id)!
                : workedSet.has(b.id)
                  ? standard
                  : 0;
            return {
              staff_id: b.id,
              name: b.name,
              employment_type: b.employment_type,
              commission_sen: commission,
              base_salary_sen: owedBase,
              standard_base_sen: isFullTime ? standard : 0,
              base_overridden: overridden,
              revenue_sen: revenueByStaff.get(b.id) ?? 0,
              total_sen: commission + owedBase,
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
    loadBarbers();
  }, [loadSettings, loadBarbers]);

  // Recompute totals whenever settings or the selected period changes.
  useEffect(() => {
    if (settings) loadTotals(settings, period);
  }, [settings, period, loadTotals]);

  // Reload earnings when the month or barber filter changes.
  useEffect(() => {
    loadEarnings(period, earningsBarber);
  }, [period, earningsBarber, loadEarnings]);

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

  function openSalaryEdit(b: BarberTotal) {
    setSalaryTarget(b);
    // Prefill with the shown owed base, or the standard if this month is RM 0
    // (e.g. no shift yet) so the admin starts from a sensible number.
    const prefill = b.base_salary_sen > 0 ? b.base_salary_sen : b.standard_base_sen;
    setSalaryText((prefill / 100).toFixed(2));
  }

  function parseSalary(): number | null {
    const amount = parseFloat(salaryText.replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) {
      const msg = 'Enter a non-negative RM amount.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Invalid amount', msg);
      return null;
    }
    return Math.round(amount * 100);
  }

  // Set the base salary for THIS month only (an override — e.g. unpaid leave).
  async function saveSalaryThisMonth() {
    if (!salaryTarget) return;
    const sen = parseSalary();
    if (sen === null) return;
    setSalaryBusy(true);
    const { error } = await supabase.from('salary_overrides').upsert({
      staff_id: salaryTarget.staff_id,
      period_year: period.year,
      period_month: period.month,
      base_sen: sen,
      updated_at: new Date().toISOString()
    });
    setSalaryBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setSalaryTarget(null);
    if (settings) loadTotals(settings, period);
  }

  // Set the barber's STANDARD base salary (applies to every month that uses the
  // standard). Clears any override for the displayed month so it follows the new
  // standard immediately.
  async function saveSalaryStandard() {
    if (!salaryTarget) return;
    const sen = parseSalary();
    if (sen === null) return;
    setSalaryBusy(true);
    const { error: e1 } = await supabase
      .from('staff')
      .update({ base_salary_sen: sen })
      .eq('id', salaryTarget.staff_id);
    if (!e1) {
      await supabase
        .from('salary_overrides')
        .delete()
        .eq('staff_id', salaryTarget.staff_id)
        .eq('period_year', period.year)
        .eq('period_month', period.month);
    }
    setSalaryBusy(false);
    if (e1) {
      Alert.alert('Error', e1.message);
      return;
    }
    setSalaryTarget(null);
    if (settings) loadTotals(settings, period);
  }

  // Remove this month's override so it falls back to the standard.
  async function resetSalaryThisMonth() {
    if (!salaryTarget) return;
    setSalaryBusy(true);
    const { error } = await supabase
      .from('salary_overrides')
      .delete()
      .eq('staff_id', salaryTarget.staff_id)
      .eq('period_year', period.year)
      .eq('period_month', period.month);
    setSalaryBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setSalaryTarget(null);
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
      loadBarbers(),
      loadEarnings(period, earningsBarber),
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

  const cur = thisPeriod();
  const offCurrentMonth = period.year !== cur.year || period.month !== cur.month;

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
        {(['totals', 'earnings'] as Tab[]).map((t) => {
          const on = tab === t;
          const label = t === 'totals' ? 'Totals' : 'Earnings';
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

      {/* Month selector — shared by both tabs. */}
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
              <Text style={s.todayBtnText}>This month</Text>
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

      {tab === 'totals' && (
        <>
          {/* Shop-wide summary for the selected month. */}
          {summary && (() => {
            const baseOwed = (totals ?? []).reduce((a, t) => a + t.base_salary_sen, 0);
            const net = summary.revenue - summary.commission - baseOwed;
            return (
              <View style={s.summaryCard}>
                <View style={s.summaryRow}>
                  <Text style={s.summaryLabel}>Total revenue</Text>
                  <Text style={s.summaryValue}>{formatRM(summary.revenue)}</Text>
                </View>
                <View style={s.summaryRow}>
                  <Text style={s.summaryLabelMuted}>Commissions</Text>
                  <Text style={s.summaryValueMuted}>− {formatRM(summary.commission)}</Text>
                </View>
                <View style={s.summaryRow}>
                  <Text style={s.summaryLabelMuted}>Base salaries</Text>
                  <Text style={s.summaryValueMuted}>− {formatRM(baseOwed)}</Text>
                </View>
                <View style={[s.summaryRow, s.summaryRowGrand]}>
                  <Text style={s.summaryLabelGrand}>Net profit</Text>
                  <Text style={[s.summaryValueGrand, net < 0 && s.negative]}>
                    {formatRM(net)}
                  </Text>
                </View>
                <Text style={s.summaryHint}>
                  Net profit = revenue − commissions − base salaries (this month).
                </Text>
              </View>
            );
          })()}

          {totals === null && <ActivityIndicator color={colors.muted} />}
          {totals && totals.length === 0 && (
            <Text style={s.muted}>No active barbers yet.</Text>
          )}
          {totals?.map((t) => (
            <View key={t.staff_id} style={s.totalCard}>
              <View style={s.totalHeader}>
                <View style={s.totalIdent}>
                  <View style={s.barberAvatar}>
                    <Text style={s.barberAvatarText}>
                      {t.name.trim().charAt(0).toUpperCase() || '?'}
                    </Text>
                  </View>
                  <Text style={s.totalName} numberOfLines={1}>
                    {t.name}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
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
                <Pressable style={s.totalRow} onPress={() => openSalaryEdit(t)} hitSlop={6}>
                  <View style={s.baseLabelRow}>
                    <Text style={s.totalLabel}>Base salary</Text>
                    {t.base_overridden && <Text style={s.overridePill}>override</Text>}
                  </View>
                  <View style={s.baseValueRow}>
                    <Text style={s.totalValue}>{formatRM(t.base_salary_sen)}</Text>
                    <Ionicons name="create-outline" size={14} color={colors.muted} />
                  </View>
                </Pressable>
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
          {/* Barber filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.filterRow}
          >
            <Pressable
              onPress={() => setEarningsBarber('all')}
              style={[s.filterPill, earningsBarber === 'all' && s.filterPillOn]}
            >
              <View style={[s.filterAvatar, earningsBarber === 'all' && s.filterAvatarOn]}>
                <Ionicons
                  name="people"
                  size={12}
                  color={earningsBarber === 'all' ? colors.primaryText : colors.accentDeep}
                />
              </View>
              <Text
                style={[s.filterPillText, earningsBarber === 'all' && s.filterPillTextOn]}
              >
                All barbers
              </Text>
            </Pressable>
            {barbers.map((b) => {
              const on = earningsBarber === b.id;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => setEarningsBarber(b.id)}
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
          </ScrollView>

          {earnings === null && <ActivityIndicator color={colors.muted} />}
          {earnings && earnings.length === 0 && (
            <Text style={s.muted}>
              No commissions this month{earningsBarber !== 'all' ? ' for this barber' : ''}.
            </Text>
          )}
          {earnings?.map((e) => (
            <View key={e.id} style={s.row}>
              <View style={s.barberAvatar}>
                <Text style={s.barberAvatarText}>
                  {(e.staff?.name ?? '?').trim().charAt(0).toUpperCase() || '?'}
                </Text>
              </View>
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
    </ScrollView>

    <Modal
      visible={showSettings}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={() => setShowSettings(false)}
    >
      <SafeAreaView style={s.modalContainer} edges={['top']}>
        <View style={s.modalHeader}>
          <Pressable onPress={() => setShowSettings(false)} hitSlop={8}>
            <Text style={s.modalCancel}>Close</Text>
          </Pressable>
          <Text style={s.modalTitle}>Pay settings</Text>
          <Pressable
            onPress={handleSaveSettings}
            disabled={savingSettings}
            style={({ pressed }) => [s.saveBtn, savingSettings && s.disabled, pressed && s.pressed]}
          >
            <Text style={s.saveBtnText}>{savingSettings ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={s.modalBody}>
          <View style={s.formCard}>
          <Text style={s.label}>Full-time base salary (monthly)</Text>
          <View style={s.affixField}>
            <Text style={s.affixPrefix}>RM</Text>
            <TextInput
              style={s.affixInput}
              value={baseText}
              onChangeText={setBaseText}
              keyboardType="decimal-pad"
              placeholder="1700.00"
              placeholderTextColor={colors.subtle}
            />
          </View>

          <Text style={s.label}>Full-time commission</Text>
          <View style={s.affixField}>
            <TextInput
              style={s.affixInput}
              value={ftPctText}
              onChangeText={setFtPctText}
              keyboardType="number-pad"
              placeholder="10"
              placeholderTextColor={colors.subtle}
            />
            <Text style={s.affixSuffix}>%</Text>
          </View>

          <Text style={s.label}>Commission-only</Text>
          <View style={s.affixField}>
            <TextInput
              style={s.affixInput}
              value={coPctText}
              onChangeText={setCoPctText}
              keyboardType="number-pad"
              placeholder="50"
              placeholderTextColor={colors.subtle}
            />
            <Text style={s.affixSuffix}>%</Text>
          </View>
          </View>

          <Text style={s.helpText}>
            Changes only affect future commissions. Past earnings stay at the rate that
            was active when they were earned.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>

    {/* Per-barber base salary editor */}
    <Modal
      visible={!!salaryTarget}
      animationType="fade"
      transparent
      onRequestClose={() => setSalaryTarget(null)}
    >
      <View style={s.salaryOverlay}>
        <View style={s.salaryCard}>
          <Text style={s.salaryTitle}>Base salary</Text>
          {salaryTarget && (
            <Text style={s.salarySub}>
              {salaryTarget.name} · {monthLabel(period.year, period.month)}
            </Text>
          )}

          <Text style={s.label}>Amount (RM, monthly)</Text>
          <TextInput
            style={s.input}
            value={salaryText}
            onChangeText={setSalaryText}
            keyboardType="decimal-pad"
            placeholder="1700.00"
            placeholderTextColor={colors.subtle}
            autoFocus
          />
          {salaryTarget && (
            <Text style={s.salaryHint}>
              Standard: {formatRM(salaryTarget.standard_base_sen)}
              {salaryTarget.base_overridden ? ' · this month is overridden' : ''}
            </Text>
          )}

          <Pressable
            style={[s.salaryPrimary, salaryBusy && s.disabled]}
            onPress={saveSalaryThisMonth}
            disabled={salaryBusy}
          >
            <Text style={s.salaryPrimaryText}>Save for this month only</Text>
          </Pressable>
          <Pressable
            style={[s.salarySecondary, salaryBusy && s.disabled]}
            onPress={saveSalaryStandard}
            disabled={salaryBusy}
          >
            <Text style={s.salarySecondaryText}>Set as standard (all months)</Text>
          </Pressable>
          {salaryTarget?.base_overridden && (
            <Pressable
              style={s.salaryReset}
              onPress={resetSalaryThisMonth}
              disabled={salaryBusy}
            >
              <Text style={s.salaryResetText}>Reset this month to standard</Text>
            </Pressable>
          )}
          <Pressable
            style={s.salaryCancel}
            onPress={() => setSalaryTarget(null)}
            disabled={salaryBusy}
          >
            <Text style={s.salaryCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
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
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999
  },
  saveBtnText: { color: colors.primaryText, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  pressed: { opacity: 0.85 },
  modalBody: { padding: space.lg, gap: space.md },
  formCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    ...cardShadow
  },
  affixField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface
  },
  affixPrefix: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: 11
  },
  affixSuffix: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
    paddingRight: space.md,
    paddingLeft: space.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingVertical: 11
  },
  affixInput: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text
  },
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
  statusDueText: { color: colors.warn },

  // Totals summary card
  summaryCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
    marginBottom: space.sm,
    ...cardShadow
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2
  },
  summaryRowGrand: {
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: space.xs,
    marginTop: space.xs
  },
  summaryLabel: { fontSize: 13, color: colors.text, fontWeight: '500' },
  summaryValue: { fontSize: 16, color: colors.text, fontWeight: '700' },
  summaryLabelMuted: { fontSize: 12, color: colors.muted },
  summaryValueMuted: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  summaryLabelGrand: { fontSize: 13, fontWeight: '700', color: colors.text, letterSpacing: 0.2 },
  summaryValueGrand: { fontSize: 20, fontWeight: '800', color: colors.ok },
  negative: { color: colors.danger },
  summaryHint: { fontSize: 11, color: colors.subtle, marginTop: 4, fontStyle: 'italic' },

  // Earnings barber filter
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

  // Barber avatar (totals + earnings)
  barberAvatar: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  barberAvatarText: { fontSize: 15, fontWeight: '800', color: colors.accentDeep },
  totalIdent: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1, paddingRight: 8 },

  // Editable base-salary row
  baseLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  baseValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  overridePill: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.warn,
    backgroundColor: colors.warnSoft,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
    letterSpacing: 0.3,
    textTransform: 'uppercase'
  },

  // Base-salary editor modal
  salaryOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: space.lg
  },
  salaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
    ...cardShadow
  },
  salaryTitle: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  salarySub: { fontSize: 13, color: colors.muted },
  salaryHint: { fontSize: 11, color: colors.subtle, fontStyle: 'italic' },
  salaryPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: space.xs
  },
  salaryPrimaryText: { color: colors.primaryText, fontSize: 14, fontWeight: '600', letterSpacing: 0.2 },
  salarySecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center'
  },
  salarySecondaryText: { color: colors.text, fontSize: 14, fontWeight: '600', letterSpacing: 0.2 },
  salaryReset: { paddingVertical: 8, alignItems: 'center' },
  salaryResetText: { color: colors.warn, fontSize: 13, fontWeight: '600' },
  salaryCancel: { paddingVertical: 8, alignItems: 'center' },
  salaryCancelText: { color: colors.muted, fontSize: 14, fontWeight: '600' }
});
