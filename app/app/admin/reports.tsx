import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { formatRM, type EmploymentType, type ShopSettings } from '@/lib/types';
import { brand, cardShadow, colors, pageHeader, radius, space } from '@/lib/theme';
import { REPORT_LOGO_DATA_URI } from '@/lib/report-logo';
import { fetchTodaySummary, type TodaySummary } from '@/lib/today';

// ---------- shared data layer ----------

interface BarberStat {
  id: string;
  name: string;
  employment_type: EmploymentType;
  entries: number; // all queue entries (any status)
  cuts: number; // completed ('done') entries
  commission: number; // commission earned, in sen
  paidMonths: number;
  baseSalaryTotal: number; // base salary paid (full-time only), in sen
  total: number; // commission + base salary, in sen
}

interface YearReport {
  year: number;
  totals: {
    customers: number; // completed cuts shop-wide
    revenue: number; // sen, from done entries
    commissions: number; // sen
    queueCount: number;
    earningsCount: number;
    shiftsCount: number;
    salaryCount: number;
  };
  perBarber: BarberStat[];
  queue: any[];
  earnings: any[];
  shifts: any[];
  payments: any[];
  staffById: Map<string, { name: string }>;
}

// Tiny helper: HTML-escape user-supplied strings before injecting into PDF HTML.
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function yearBounds(year: number): { start: string; end: string } {
  return {
    start: new Date(Date.UTC(year, 0, 1)).toISOString(),
    end: new Date(Date.UTC(year + 1, 0, 1)).toISOString()
  };
}

// Fetch everything for the year once, then compute both the headline totals and
// the per-barber breakdown. Used by both the on-screen report and the PDF, so
// the two never disagree.
async function fetchYearReport(year: number): Promise<YearReport> {
  const { start, end } = yearBounds(year);
  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);

  const [staffRes, settingsRes, queueRes, earningsRes, shiftsRes, paymentsRes] =
    await Promise.all([
      supabase.from('staff').select('id, name, employment_type, role, active'),
      supabase.from('shop_settings').select('*').eq('id', 1).maybeSingle(),
      supabase
        .from('queue_entries')
        .select(
          `id, staff_id, customer_name, customer_phone, queue_number, queue_date, status,
           base_price_sen, final_price_sen, created_at, completed_at,
           services:service_id (name)`
        )
        .gte('queue_date', startDate)
        .lt('queue_date', endDate)
        .order('created_at'),
      supabase
        .from('earnings')
        .select('id, staff_id, amount_sen, percent_applied, earned_at')
        .gte('earned_at', start)
        .lt('earned_at', end)
        .order('earned_at'),
      supabase
        .from('shifts')
        .select('id, staff_id, started_at, ended_at')
        .gte('started_at', start)
        .lt('started_at', end)
        .order('started_at'),
      supabase
        .from('salary_payments')
        .select('staff_id, period_year, period_month, paid, paid_at, paid_amount_sen')
        .eq('period_year', year)
        .order('period_month')
    ]);

  const staff: Array<{
    id: string;
    name: string;
    employment_type: EmploymentType;
    role: string;
    active: boolean;
  }> = staffRes.data ?? [];
  const settings = (settingsRes.data as ShopSettings | null) ?? null;
  const queue = (queueRes.data ?? []) as any[];
  const earnings = (earningsRes.data ?? []) as any[];
  const shifts = (shiftsRes.data ?? []) as any[];
  const payments = (paymentsRes.data ?? []) as any[];

  const staffById = new Map(staff.map((st) => [st.id, { name: st.name }]));

  const totalRevenue = queue
    .filter((q) => q.status === 'done')
    .reduce((s, q) => s + (q.final_price_sen ?? 0), 0);
  const totalCustomers = queue.filter((q) => q.status === 'done').length;
  const totalCommissions = earnings.reduce((s, e) => s + e.amount_sen, 0);

  const baseSalary = settings?.full_time_base_salary_sen ?? 0;
  const perBarber: BarberStat[] = staff
    .filter((st) => st.role === 'barber')
    .map((st) => {
      const mine = queue.filter((q) => q.staff_id === st.id);
      const cuts = mine.filter((q) => q.status === 'done').length;
      const commission = earnings
        .filter((e) => e.staff_id === st.id)
        .reduce((s, e) => s + e.amount_sen, 0);
      const paidMonths = payments.filter((p) => p.staff_id === st.id && p.paid).length;
      const baseSalaryTotal =
        st.employment_type === 'full_time' ? baseSalary * paidMonths : 0;
      return {
        id: st.id,
        name: st.name,
        employment_type: st.employment_type,
        entries: mine.length,
        cuts,
        commission,
        paidMonths,
        baseSalaryTotal,
        total: commission + baseSalaryTotal
      };
    })
    // Busiest / highest-earning barbers first.
    .sort((a, b) => b.total - a.total || b.cuts - a.cuts);

  return {
    year,
    totals: {
      customers: totalCustomers,
      revenue: totalRevenue,
      commissions: totalCommissions,
      queueCount: queue.length,
      earningsCount: earnings.length,
      shiftsCount: shifts.length,
      salaryCount: payments.length
    },
    perBarber,
    queue,
    earnings,
    shifts,
    payments,
    staffById
  };
}

export default function AdminReports() {
  const thisYear = new Date().getUTCFullYear();
  const [year, setYear] = useState(thisYear);
  const [report, setReport] = useState<YearReport | null>(null);
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const loadReport = useCallback(async (y: number) => {
    setReport(null);
    try {
      const data = await fetchYearReport(y);
      // Guard against a stale response if the year changed mid-flight.
      setReport((prev) => (data.year === y ? data : prev));
    } catch (e) {
      Alert.alert('Failed to load report', e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadReport(year);
  }, [year, loadReport]);

  // Live "today so far" snapshot — shown on screen, deliberately excluded from
  // the PDF (the PDF is the annual record).
  useEffect(() => {
    fetchTodaySummary()
      .then(setToday)
      .catch(() => {});
  }, []);

  async function handleGeneratePdf() {
    if (!report) return;
    setGenerating(true);
    try {
      const html = buildReportHtml(report);
      if (Platform.OS === 'web') {
        // On web, expo-print would print the whole app window (sidebar and all).
        // Render just our document into a hidden iframe and print that, so the
        // saved PDF is the report — not a screenshot of the admin UI.
        printHtmlOnWeb(html);
      } else {
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: `${brand.name} ${year} report`,
            UTI: 'com.adobe.pdf'
          });
        } else {
          Alert.alert('Saved', `PDF written to ${uri}`);
        }
      }
    } catch (e) {
      console.error('PDF generation failed', e);
      Alert.alert('Failed', e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleArchive() {
    Alert.alert(
      `Delete ${year} data?`,
      `This deletes all queue entries, earnings, shifts, and salary payments from ${year}. Catalog tables (staff, services, products, discounts) stay.\n\nGenerate the PDF first and confirm it's saved before deleting.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setArchiving(true);
            const { data, error } = await supabase
              .rpc('archive_year_delete', { p_year: year })
              .single<{
                deleted_queue_entries: number;
                deleted_earnings: number;
                deleted_shifts: number;
                deleted_salary_payments: number;
              }>();
            setArchiving(false);
            if (error) {
              Alert.alert('Archive failed', error.message);
              return;
            }
            Alert.alert(
              'Archived',
              `Deleted ${data?.deleted_queue_entries ?? 0} queue entries, ` +
                `${data?.deleted_earnings ?? 0} earnings, ` +
                `${data?.deleted_shifts ?? 0} shifts, ` +
                `${data?.deleted_salary_payments ?? 0} salary payments.`
            );
            loadReport(year);
          }
        }
      ]
    );
  }

  const totals = report?.totals;
  const isEmpty =
    totals != null &&
    totals.queueCount === 0 &&
    totals.earningsCount === 0 &&
    totals.shiftsCount === 0 &&
    totals.salaryCount === 0;

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.scrollContent}>
      <View style={pageHeader.wrap}>
        <Text style={pageHeader.subtitle}>Reports</Text>
        <Text style={pageHeader.title}>Export & archive</Text>
      </View>

      {/* Live "today so far" snapshot — not part of the PDF export. */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Today so far</Text>
        {today === null ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <>
            <View style={s.row}>
              <Text style={s.rowLabel}>Revenue</Text>
              <Text style={s.rowValue}>{formatRM(today.revenue_sen)}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Customers served</Text>
              <Text style={s.rowValue}>{today.customersServed.toLocaleString()}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabelMuted}>In queue now</Text>
              <Text style={s.rowValueMuted}>{today.inQueue.toLocaleString()}</Text>
            </View>
          </>
        )}
      </View>

      <View style={s.yearBar}>
        <Pressable hitSlop={8} onPress={() => setYear((y) => y - 1)} style={s.arrow}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Text style={s.yearLabel}>{year}</Text>
        <Pressable
          hitSlop={8}
          onPress={() => setYear((y) => Math.min(thisYear, y + 1))}
          style={s.arrow}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Headline totals */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Records in {year}</Text>
        {report === null ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <>
            <View style={s.row}>
              <Text style={s.rowLabel}>Customers served</Text>
              <Text style={s.rowValue}>{totals!.customers.toLocaleString()}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Revenue</Text>
              <Text style={s.rowValue}>{formatRM(totals!.revenue)}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Commissions paid</Text>
              <Text style={s.rowValue}>{formatRM(totals!.commissions)}</Text>
            </View>
            <View style={s.divider} />
            <View style={s.row}>
              <Text style={s.rowLabelMuted}>Queue entries</Text>
              <Text style={s.rowValueMuted}>{totals!.queueCount.toLocaleString()}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabelMuted}>Shifts</Text>
              <Text style={s.rowValueMuted}>{totals!.shiftsCount.toLocaleString()}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabelMuted}>Salary payments</Text>
              <Text style={s.rowValueMuted}>{totals!.salaryCount.toLocaleString()}</Text>
            </View>
          </>
        )}
      </View>

      {/* Per-barber breakdown */}
      <Text style={s.sectionLabel}>Per barber · {year}</Text>
      {report === null ? (
        <View style={s.card}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : report.perBarber.length === 0 ? (
        <View style={s.card}>
          <Text style={s.empty}>No barbers on record.</Text>
        </View>
      ) : (
        report.perBarber.map((b) => (
          <View key={b.id} style={s.barberCard}>
            <View style={s.barberHeader}>
              <Text style={s.bName} numberOfLines={1}>
                {b.name}
              </Text>
              <Text style={s.typePill}>
                {b.employment_type === 'full_time' ? 'Full-time' : 'Commission'}
              </Text>
            </View>
            <Text style={s.bStats}>
              {b.entries} {b.entries === 1 ? 'entry' : 'entries'} · {b.cuts}{' '}
              {b.cuts === 1 ? 'cut' : 'cuts'}
            </Text>
            <View style={s.bRow}>
              <Text style={s.bRowLabel}>Commission</Text>
              <Text style={s.bRowValue}>{formatRM(b.commission)}</Text>
            </View>
            {b.employment_type === 'full_time' && (
              <View style={s.bRow}>
                <Text style={s.bRowLabel}>Base salary</Text>
                <Text style={s.bRowValue}>{formatRM(b.baseSalaryTotal)}</Text>
              </View>
            )}
            <View style={[s.bRow, s.bRowGrand]}>
              <Text style={s.bRowLabelGrand}>Total earned</Text>
              <Text style={s.bRowValueGrand}>{formatRM(b.total)}</Text>
            </View>
          </View>
        ))
      )}

      <Pressable
        style={[s.primary, (generating || isEmpty || report === null) && s.disabled]}
        onPress={handleGeneratePdf}
        disabled={generating || isEmpty || report === null}
      >
        {generating ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text style={s.primaryText}>
            {isEmpty ? 'Nothing to export' : `Generate PDF report for ${year}`}
          </Text>
        )}
      </Pressable>

      <View style={s.warningCard}>
        <Text style={s.warningTitle}>Danger zone</Text>
        <Text style={s.warningBody}>
          After you've generated the PDF and saved it somewhere safe, you can permanently
          delete this year's operational data from Supabase to free up space. Catalog
          tables (staff, services, products, discount codes) are never touched.
        </Text>
        <Pressable
          style={[s.danger, (archiving || isEmpty) && s.disabled]}
          onPress={handleArchive}
          disabled={archiving || isEmpty}
        >
          {archiving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.dangerText}>Delete {year} from database</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

// On web only: write the report HTML into an offscreen iframe and print just
// that document. Avoids expo-print's web fallback, which prints the whole app
// window (sidebar included). Typed loosely so this never pulls DOM types into
// the native build — it's only ever called when Platform.OS === 'web'.
function printHtmlOnWeb(html: string): void {
  const d: any = (globalThis as any).document;
  if (!d?.body) return;

  const iframe = d.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  d.body.appendChild(iframe);

  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();

  const doPrint = () => {
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 1000);
  };
  // Give the inlined base64 logo a moment to decode before printing.
  if (win.document.readyState === 'complete') {
    setTimeout(doPrint, 150);
  } else {
    iframe.onload = () => setTimeout(doPrint, 150);
  }
}

// ---------- PDF report builder ----------

function buildReportHtml(report: YearReport): string {
  const { year, totals, perBarber, queue, shifts, payments, staffById } = report;

  const barberRows = perBarber
    .map(
      (b) => `
      <tr>
        <td>${esc(b.name)}</td>
        <td>${b.employment_type === 'full_time' ? 'Full-time' : 'Commission'}</td>
        <td class="right">${b.entries}</td>
        <td class="right">${b.cuts}</td>
        <td class="right">${esc(formatRM(b.commission))}</td>
        <td class="right">${esc(formatRM(b.baseSalaryTotal))}</td>
        <td class="right strong">${esc(formatRM(b.total))}</td>
      </tr>`
    )
    .join('');

  const queueRows = queue
    .map(
      (q) => `
      <tr>
        <td>${esc(q.queue_date)}</td>
        <td>${esc(q.customer_name)}</td>
        <td>${esc(staffById.get(q.staff_id)?.name ?? '—')}</td>
        <td>${esc(q.services?.name ?? '—')}</td>
        <td class="right">${esc(formatRM(q.final_price_sen))}</td>
        <td>${esc(q.status)}</td>
      </tr>`
    )
    .join('');

  const shiftRows = shifts
    .map((sh) => {
      const startD = new Date(sh.started_at);
      const endD = sh.ended_at ? new Date(sh.ended_at) : null;
      const minutes = endD ? Math.round((endD.getTime() - startD.getTime()) / 60000) : 0;
      return `
        <tr>
          <td>${esc(staffById.get(sh.staff_id)?.name ?? '—')}</td>
          <td>${esc(startD.toLocaleString())}</td>
          <td>${esc(endD ? endD.toLocaleString() : 'still on shift')}</td>
          <td class="right">${minutes > 0 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : '—'}</td>
        </tr>`;
    })
    .join('');

  const paymentRows = payments
    .map((p) => {
      const label = new Date(Date.UTC(p.period_year, p.period_month - 1, 1)).toLocaleDateString(
        undefined,
        { month: 'long', year: 'numeric', timeZone: 'UTC' }
      );
      return `
        <tr>
          <td>${esc(label)}</td>
          <td>${esc(staffById.get(p.staff_id)?.name ?? '—')}</td>
          <td class="right">${esc(formatRM(p.paid_amount_sen ?? 0))}</td>
          <td>${p.paid ? esc(new Date(p.paid_at).toLocaleDateString()) : 'Due'}</td>
        </tr>`;
    })
    .join('');

  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  /* margin:0 removes the browser's auto print header/footer (date, page title,
     URL, page number). We inset the content ourselves via body padding. */
  @page { size: A4 portrait; margin: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #1c1917; padding: 40px 44px 44px; line-height: 1.45; }

  /* Branded document header band. */
  .report-header { background: #0A0A0A; color: #E8DDC9; text-align: center;
                   border-radius: 12px; margin: 0 0 28px; padding: 30px 40px 24px; }
  .report-header .logo { width: 62px; height: 62px; border-radius: 50%;
                         object-fit: cover; display: block; margin: 0 auto 14px; }
  .report-header .brand { font-size: 22px; font-weight: 800; letter-spacing: 3px;
                          text-transform: uppercase; color: #E8DDC9; }
  .report-header .kicker { font-size: 10px; letter-spacing: 5px; color: #B89865;
                           text-transform: uppercase; margin-top: 12px; }
  .report-header .year { font-size: 38px; font-weight: 800; color: #B89865;
                         letter-spacing: 1px; margin-top: 0; line-height: 1.1; }
  .generated { color: #78716c; font-size: 11px; text-align: center; margin: 0 0 26px; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 0 8px; }
  .summary-card { border: 1px solid #e7e5e4; border-radius: 8px; padding: 14px 16px; }
  .summary-card .label { font-size: 10px; color: #78716c; text-transform: uppercase;
                         letter-spacing: 1px; }
  .summary-card .value { font-size: 22px; font-weight: 800; margin-top: 4px; color: #1c1917; }

  h2 { font-size: 15px; margin: 30px 0 8px; padding-bottom: 6px;
       border-bottom: 2px solid #B89865; color: #1c1917;
       text-transform: uppercase; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; font-size: 10px; color: #78716c;
       text-transform: uppercase; letter-spacing: 0.5px;
       padding: 6px 8px; border-bottom: 1px solid #e7e5e4; }
  td { padding: 6px 8px; border-bottom: 1px solid #f5f4f3; }
  tbody tr:nth-child(even) { background: #faf9f7; }
  .right { text-align: right; }
  .strong { font-weight: 700; color: #1c1917; }
  .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e7e5e4;
            font-size: 10px; color: #a8a29e; text-align: center; }
</style>
</head>
<body>
  <div class="report-header">
    <img class="logo" src="${REPORT_LOGO_DATA_URI}" alt="${esc(brand.name)}" />
    <div class="brand">${esc(brand.name)}</div>
    <div class="kicker">Annual Report</div>
    <div class="year">${year}</div>
  </div>
  <p class="generated">Generated ${esc(generatedAt)}</p>

  <div class="grid">
    <div class="summary-card">
      <div class="label">Customers served</div>
      <div class="value">${totals.customers.toLocaleString()}</div>
    </div>
    <div class="summary-card">
      <div class="label">Revenue</div>
      <div class="value">${esc(formatRM(totals.revenue))}</div>
    </div>
    <div class="summary-card">
      <div class="label">Commissions paid</div>
      <div class="value">${esc(formatRM(totals.commissions))}</div>
    </div>
    <div class="summary-card">
      <div class="label">Shifts worked</div>
      <div class="value">${totals.shiftsCount.toLocaleString()}</div>
    </div>
  </div>

  <h2>Per-barber breakdown</h2>
  <table>
    <thead>
      <tr>
        <th>Barber</th><th>Type</th>
        <th class="right">Entries</th>
        <th class="right">Cuts</th>
        <th class="right">Commission</th>
        <th class="right">Base salary</th>
        <th class="right">Total earned</th>
      </tr>
    </thead>
    <tbody>${barberRows || '<tr><td colspan="7">No barbers.</td></tr>'}</tbody>
  </table>

  <h2>Salary payments (${payments.length})</h2>
  <table>
    <thead>
      <tr><th>Period</th><th>Barber</th><th class="right">Amount</th><th>Paid on</th></tr>
    </thead>
    <tbody>${paymentRows || '<tr><td colspan="4">No payments recorded.</td></tr>'}</tbody>
  </table>

  <h2>Shifts (${shifts.length})</h2>
  <table>
    <thead>
      <tr><th>Barber</th><th>Start</th><th>End</th><th class="right">Duration</th></tr>
    </thead>
    <tbody>${shiftRows || '<tr><td colspan="4">No shifts.</td></tr>'}</tbody>
  </table>

  <h2>Queue entries (${queue.length})</h2>
  <table>
    <thead>
      <tr><th>Date</th><th>Customer</th><th>Barber</th><th>Service</th>
          <th class="right">Price</th><th>Status</th></tr>
    </thead>
    <tbody>${queueRows || '<tr><td colspan="6">No queue entries.</td></tr>'}</tbody>
  </table>

  <p class="footer">${esc(brand.name)} · Annual Report ${year} · generated ${esc(generatedAt)}</p>
</body>
</html>`;
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },

  yearBar: {
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
  arrow: {
    width: 40,
    height: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center'
  },
  yearLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: 6,
    ...cardShadow
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.4,
    marginBottom: 4
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { fontSize: 13, color: colors.text },
  rowValue: { fontSize: 18, color: colors.text, fontWeight: '700' },
  rowLabelMuted: { fontSize: 12, color: colors.muted },
  rowValueMuted: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  empty: { fontSize: 13, color: colors.muted, paddingVertical: 6 },

  // Per-barber cards
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.4,
    marginTop: space.xs,
    marginBottom: 2
  },
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
  typePill: {
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
  bStats: { fontSize: 12, color: colors.muted, marginBottom: 4 },
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
  bRowLabelGrand: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.3
  },
  bRowValueGrand: { fontSize: 17, fontWeight: '700', color: colors.text },

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

  warningCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.lg,
    gap: space.sm,
    ...cardShadow
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.danger,
    letterSpacing: 0.2
  },
  warningBody: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  danger: {
    backgroundColor: colors.danger,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: space.xs
  },
  dangerText: { color: '#fff', fontSize: 14, fontWeight: '600', letterSpacing: 0.2 }
});
