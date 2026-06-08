import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import {
  buildWhatsAppUrl,
  buildWhatsAppBusinessIntent,
  formatRM,
  type Break,
  type QueueEntry,
  type Service,
  type Shift,
  type Staff
} from '@/lib/types';
import { brand, colors, radius, space, cardShadow } from '@/lib/theme';

interface QueueEntryWithService extends QueueEntry {
  services?: { name: string } | null;
}

export default function StaffDashboard() {
  const router = useRouter();
  const { staffId } = useLocalSearchParams<{ staffId: string }>();

  const [target, setTarget] = useState<Staff | null | 'unknown'>('unknown');
  const [shift, setShift] = useState<Shift | null | 'unknown'>('unknown');
  const [services, setServices] = useState<Service[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueueEntryWithService[]>([]);
  const [activeBreak, setActiveBreak] = useState<Break | null>(null);
  const [busy, setBusy] = useState(false);

  // Price adjustment modal.
  const [adjustTarget, setAdjustTarget] = useState<QueueEntryWithService | null>(null);
  const [adjustMode, setAdjustMode] = useState<'add' | 'reduce'>('add');
  const [adjustText, setAdjustText] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);

  // Custom-service price entry (barber sets the price before finishing).
  const [customPriceText, setCustomPriceText] = useState('');
  const [customPriceBusy, setCustomPriceBusy] = useState(false);

  useEffect(() => {
    if (!staffId) return;
    let cancelled = false;
    (async () => {
      const [staffRes, shiftRes, servicesRes] = await Promise.all([
        supabase.from('staff').select('*').eq('id', staffId).maybeSingle(),
        supabase
          .from('shifts')
          .select('*')
          .eq('staff_id', staffId)
          .is('ended_at', null)
          .maybeSingle(),
        supabase.from('services').select('*').eq('active', true).order('price_sen')
      ]);
      if (cancelled) return;
      setTarget((staffRes.data as Staff) ?? null);
      setShift((shiftRes.data as Shift) ?? null);
      setServices((servicesRes.data as Service[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [staffId]);

  const loadQueue = useCallback(async () => {
    if (!staffId) return;
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('queue_entries')
      .select(
        `id, staff_id, shift_id, queue_number, queue_date, status, service_id,
         customer_name, base_price_sen, final_price_sen, price_adjustment_sen, discount_percent,
         created_at, started_at, completed_at,
         services:service_id ( name )`
      )
      .eq('staff_id', staffId)
      .eq('queue_date', today)
      .in('status', ['waiting', 'in_progress'])
      .order('queue_number');
    if (error) {
      console.warn('loadQueue error', error.message);
    }
    setQueue((data as unknown as QueueEntryWithService[]) ?? []);
  }, [staffId]);

  const loadBreak = useCallback(async () => {
    if (!staffId) return;
    const { data } = await supabase
      .from('breaks')
      .select('*')
      .eq('staff_id', staffId)
      .is('ended_at', null)
      .maybeSingle();
    setActiveBreak((data as Break) ?? null);
  }, [staffId]);

  useEffect(() => {
    if (!staffId || shift === 'unknown') return;
    loadQueue();
    loadBreak();
    const channel = supabase
      .channel(`staff-${staffId}-queue-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue_entries',
          filter: `staff_id=eq.${staffId}`
        },
        loadQueue
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'breaks',
          filter: `staff_id=eq.${staffId}`
        },
        loadBreak
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [shift, staffId, loadQueue, loadBreak]);

  async function handleStartShift() {
    if (selected.size === 0) {
      Alert.alert('Pick services', 'Select at least one service for this shift.');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .rpc('start_shift', {
        p_service_ids: Array.from(selected),
        p_staff_id: staffId
      })
      .single<Shift>();
    setBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setShift(data);
  }

  async function handleEndShift() {
    setBusy(true);
    const { error } = await supabase.rpc('end_shift', { p_staff_id: staffId });
    setBusy(false);
    if (error) {
      Alert.alert('End shift failed', error.message);
      return;
    }
    setShift(null);
    setSelected(new Set());
  }

  // Manual flow: completing the current cut does NOT auto-start the next one.
  async function handleComplete() {
    setBusy(true);
    const { error } = await supabase.rpc('complete_current_entry', { p_staff_id: staffId });
    setBusy(false);
    if (error) Alert.alert('Error', error.message);
  }

  async function handleStartNext() {
    setBusy(true);
    const { error } = await supabase.rpc('start_next_entry', { p_staff_id: staffId });
    setBusy(false);
    if (error) Alert.alert('Error', error.message);
  }

  async function handleStartBreak() {
    setBusy(true);
    const { error } = await supabase.rpc('start_break', { p_staff_id: staffId });
    setBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    loadBreak();
  }

  async function handleEndBreak() {
    setBusy(true);
    const { error } = await supabase.rpc('end_break', { p_staff_id: staffId });
    setBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    loadBreak();
  }

  async function handleCancelEntry(entry: QueueEntryWithService, kind: 'waiting' | 'in_chair') {
    const title = `Cancel ${entry.customer_name}?`;
    const body =
      kind === 'in_chair'
        ? 'No commission will be recorded.'
        : 'Removes them from the queue.';

    const doCancel = async () => {
      setBusy(true);
      const { error } = await supabase.rpc('staff_cancel_queue_entry', {
        p_entry_id: entry.id
      });
      setBusy(false);
      if (error) {
        if (Platform.OS === 'web') window.alert(`Cancel failed: ${error.message}`);
        else Alert.alert('Cancel failed', error.message);
        return;
      }
      loadQueue();
    };

    // React Native's Alert.alert with multiple buttons doesn't render on web,
    // so fall back to window.confirm() there.
    if (Platform.OS === 'web') {
      if (window.confirm(`${title}\n\n${body}`)) await doCancel();
      return;
    }

    Alert.alert(title, body, [
      { text: 'Back', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: doCancel }
    ]);
  }

  function openAdjust(entry: QueueEntryWithService, mode: 'add' | 'reduce') {
    setAdjustTarget(entry);
    setAdjustMode(mode);
    setAdjustText('');
  }

  async function handleAdjustSubmit() {
    if (!adjustTarget) return;
    const amount = parseFloat(adjustText.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      const msg = 'Enter an amount greater than 0.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Invalid amount', msg);
      return;
    }
    const deltaSen = Math.round(amount * 100) * (adjustMode === 'add' ? 1 : -1);
    setAdjustBusy(true);
    const { error } = await supabase.rpc('staff_adjust_entry_price', {
      p_entry_id: adjustTarget.id,
      p_delta_sen: deltaSen
    });
    setAdjustBusy(false);
    if (error) {
      const msg = `Adjust failed: ${error.message}`;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Adjust failed', error.message);
      return;
    }
    setAdjustTarget(null);
    setAdjustText('');
    loadQueue();
  }

  async function handleSetCustomPrice(entry: QueueEntryWithService) {
    const amount = parseFloat(customPriceText.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      const msg = 'Enter an amount greater than 0.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Invalid amount', msg);
      return;
    }
    setCustomPriceBusy(true);
    const { error } = await supabase.rpc('staff_set_custom_price', {
      p_entry_id: entry.id,
      p_price_sen: Math.round(amount * 100)
    });
    setCustomPriceBusy(false);
    if (error) {
      if (Platform.OS === 'web') window.alert(`Set price failed: ${error.message}`);
      else Alert.alert('Set price failed', error.message);
      return;
    }
    setCustomPriceText('');
    loadQueue();
  }

  async function handleSendReceipt(entry: QueueEntryWithService) {
    // On Android (incl. the web PWA in Chrome) we route receipts to WhatsApp
    // *Business* via an intent:// URL — done by navigating the current page, so
    // no pre-opened tab is needed. Everywhere else we use wa.me.
    const androidWeb =
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      /android/i.test(navigator.userAgent);
    // iOS Safari blocks window.open once an await has run (the phone fetch
    // below breaks the user-gesture). So on web we open the tab synchronously
    // now and just redirect it to the wa.me URL once it's built.
    const waWindow =
      Platform.OS === 'web' && !androidWeb ? window.open('', '_blank') : null;

    const svcName = entry.services?.name ?? 'Custom service';
    const base = entry.base_price_sen ?? 0;
    const final = entry.final_price_sen ?? 0;
    const adj = entry.price_adjustment_sen;
    const discount = base + adj - final;
    const lines = [`${svcName} - ${formatRM(base)}`];
    if (adj > 0) lines.push(`Add-on - +${formatRM(adj)}`);
    else if (adj < 0) lines.push(`Reduction - -${formatRM(Math.abs(adj))}`);
    if (discount > 0) lines.push(`Discount - -${formatRM(discount)}`);
    lines.push(`Total - ${formatRM(final)}`);

    // customer_phone is no longer readable over the API; fetch it for this one
    // entry through the operator-gated RPC.
    const { data: phone, error: phoneErr } = await supabase.rpc('get_entry_phone', {
      p_entry_id: entry.id
    });
    if (phoneErr || !phone) {
      waWindow?.close();
      Alert.alert('Could not load contact', phoneErr?.message ?? 'No phone on file.');
      return;
    }

    const message =
      `Hi ${entry.customer_name}!\n\nThanks for visiting ${brand.name}.\n\n` +
      lines.join('\n') +
      `\n\nQueue #${entry.queue_number}\n\nSee you next time!`;
    const url = buildWhatsAppUrl(phone as string, message);
    if (Platform.OS === 'web') {
      if (androidWeb) {
        // Force WhatsApp Business; falls back to wa.me if it isn't installed.
        window.location.href = buildWhatsAppBusinessIntent(phone as string, message);
      } else if (waWindow) {
        // wa.me opens WhatsApp Web / the app from a browser even without the
        // native app installed, so no canOpenURL gate is needed here.
        waWindow.location.href = url;
      } else {
        window.open(url, '_blank');
      }
    } else {
      // Native Android: also target Business; iOS has no package selector so it
      // uses the plain wa.me link.
      const nativeUrl =
        Platform.OS === 'android'
          ? buildWhatsAppBusinessIntent(phone as string, message)
          : url;
      try {
        await Linking.openURL(nativeUrl);
      } catch {
        Alert.alert('Could not open WhatsApp', 'Make sure WhatsApp is installed.');
      }
    }
  }

  function HeaderRight() {
    return (
      <Pressable onPress={() => router.push('/admin')} hitSlop={8} style={s.headerBtn}>
        <Text style={s.headerBtnText}>Admin ›</Text>
      </Pressable>
    );
  }

  if (target === 'unknown' || shift === 'unknown') {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  if (!target) {
    return (
      <View style={s.center}>
        <Text style={s.muted}>Staff not found.</Text>
      </View>
    );
  }

  // CLOCK-IN view
  if (!shift && queue.length === 0) {
    return (
      <ScrollView contentContainerStyle={s.scrollContent} style={s.flex}>
        <Stack.Screen
          options={{ title: `Clock in · ${target.name}`, headerRight: HeaderRight }}
        />
        <Text style={s.h1}>{target.name}</Text>
        <Text style={s.subtitle}>Pick the services for this shift.</Text>

        {services.length === 0 ? (
          <Text style={s.muted}>No services available. Add some in admin first.</Text>
        ) : (
          services.map((svc) => {
            const on = selected.has(svc.id);
            return (
              <Pressable
                key={svc.id}
                onPress={() => {
                  const next = new Set(selected);
                  if (on) next.delete(svc.id);
                  else next.add(svc.id);
                  setSelected(next);
                }}
                style={[s.serviceCard, on && s.serviceCardOn]}
              >
                <View style={[s.checkbox, on && s.checkboxOn]}>
                  {on && <Text style={s.checkmark}>✓</Text>}
                </View>
                <View style={{ flex: 1, marginLeft: space.md }}>
                  <Text style={s.serviceName}>{svc.name}</Text>
                  <Text style={s.serviceMeta}>~{svc.duration_minutes} min</Text>
                </View>
                <Text style={s.servicePrice}>{formatRM(svc.price_sen)}</Text>
              </Pressable>
            );
          })
        )}

        <Pressable
          style={[s.primary, busy && s.disabled]}
          onPress={handleStartShift}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={s.primaryText}>Start shift →</Text>
          )}
        </Pressable>
      </ScrollView>
    );
  }

  // QUEUE DASHBOARD view
  const inProgress = queue.find((q) => q.status === 'in_progress');
  const waiting = queue.filter((q) => q.status === 'waiting');
  const onShift = !!shift;
  // A custom-service entry that the barber hasn't priced yet — must set a price
  // before the cut can be completed.
  const inProgressCustomUnpriced =
    !!inProgress && inProgress.service_id == null && inProgress.final_price_sen == null;

  return (
    <>
    <ScrollView contentContainerStyle={s.scrollContent} style={s.flex}>
      <Stack.Screen options={{ title: `Queue · ${target.name}`, headerRight: HeaderRight }} />

      <View style={s.shiftStatus}>
        <View style={{ flex: 1 }}>
          {onShift ? (
            <>
              <View style={s.liveRow}>
                <View style={s.liveDot} />
                <Text style={s.liveText}>Live · {target.name} on shift</Text>
              </View>
              <Text style={s.shiftStatusText}>
                Since{' '}
                {new Date(shift!.started_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}{' '}
                · {queue.length} in queue
              </Text>
            </>
          ) : (
            <>
              <View style={s.liveRow}>
                <View style={[s.liveDot, { backgroundColor: colors.warn }]} />
                <Text style={[s.liveText, { color: colors.warn }]}>
                  Shift ended · finishing remaining
                </Text>
              </View>
              <Text style={s.shiftStatusText}>
                {queue.length} {queue.length === 1 ? 'customer' : 'customers'} left to serve
              </Text>
            </>
          )}
        </View>
        {onShift && (
          <Pressable onPress={handleEndShift} disabled={busy} style={s.endShiftBtn}>
            <Text style={s.endShiftText}>End shift</Text>
          </Pressable>
        )}
      </View>

      {/* Break control — only while on shift */}
      {onShift &&
        (activeBreak ? (
          <View style={s.breakBanner}>
            <View style={{ flex: 1 }}>
              <Text style={s.breakTitle}>On break · hidden from customers</Text>
              <Text style={s.breakSub}>
                {activeBreak.started_at
                  ? `Resting since ${new Date(activeBreak.started_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}`
                  : 'Timer starts once you finish the remaining queue'}
              </Text>
            </View>
            <Pressable onPress={handleEndBreak} disabled={busy} style={s.continueBtn}>
              <Text style={s.continueBtnText}>Continue shift</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={handleStartBreak} disabled={busy} style={s.breakBtn}>
            <Text style={s.breakBtnText}>☕  Take a break</Text>
          </Pressable>
        ))}

      {inProgress ? (
        <View style={s.currentCard}>
          <Text style={s.currentLabel}>Now serving</Text>
          <Text style={s.currentName}>{inProgress.customer_name}</Text>

          {inProgressCustomUnpriced ? (
            <>
              <Text style={s.currentMeta}>Custom service · enter the price to finish</Text>
              {inProgress.discount_percent ? (
                <Text style={s.adjustNote}>
                  {inProgress.discount_percent}% discount will apply to the price
                </Text>
              ) : null}
              <View style={s.customPriceRow}>
                <TextInput
                  style={s.customPriceInput}
                  value={customPriceText}
                  onChangeText={setCustomPriceText}
                  keyboardType="decimal-pad"
                  placeholder="Price e.g. 25.00"
                  placeholderTextColor={colors.subtle}
                  onSubmitEditing={() => handleSetCustomPrice(inProgress)}
                />
                <Pressable
                  style={[s.setPriceBtn, customPriceBusy && s.disabled]}
                  onPress={() => handleSetCustomPrice(inProgress)}
                  disabled={customPriceBusy}
                >
                  {customPriceBusy ? (
                    <ActivityIndicator color={colors.primaryText} />
                  ) : (
                    <Text style={s.setPriceBtnText}>Set price</Text>
                  )}
                </Pressable>
              </View>
              <Pressable
                style={s.cancelInChairBtn}
                onPress={() => handleCancelEntry(inProgress, 'in_chair')}
                disabled={busy}
              >
                <Text style={s.cancelInChairText}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.currentMeta}>
                {(inProgress.services?.name ?? 'Custom service')} ·{' '}
                {formatRM(inProgress.final_price_sen ?? 0)}
              </Text>
              {inProgress.price_adjustment_sen !== 0 && (
                <Text style={s.adjustNote}>
                  {inProgress.price_adjustment_sen > 0 ? 'Add-on +' : 'Reduction -'}
                  {formatRM(Math.abs(inProgress.price_adjustment_sen))} applied
                </Text>
              )}
              <View style={s.adjustRow}>
                <Pressable style={s.adjustBtn} onPress={() => openAdjust(inProgress, 'add')}>
                  <Text style={s.adjustBtnText}>+ Add charge</Text>
                </Pressable>
                <Pressable style={s.adjustBtn} onPress={() => openAdjust(inProgress, 'reduce')}>
                  <Text style={s.adjustBtnText}>− Reduce</Text>
                </Pressable>
              </View>
              <Pressable style={s.receiptBtn} onPress={() => handleSendReceipt(inProgress)}>
                <Text style={s.receiptBtnText}>Send WhatsApp receipt →</Text>
              </Pressable>
              <Pressable
                style={s.cancelInChairBtn}
                onPress={() => handleCancelEntry(inProgress, 'in_chair')}
                disabled={busy}
              >
                <Text style={s.cancelInChairText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : (
        <View style={s.emptyCard}>
          <Text style={s.muted}>
            {waiting.length > 0
              ? 'No one in chair. Tap "Start next" below.'
              : 'Queue is empty.'}
          </Text>
        </View>
      )}

      <Pressable
        style={[
          s.primary,
          (busy || inProgressCustomUnpriced || (waiting.length === 0 && !inProgress)) && s.disabled
        ]}
        onPress={inProgress ? handleComplete : handleStartNext}
        disabled={busy || inProgressCustomUnpriced || (waiting.length === 0 && !inProgress)}
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryText} />
        ) : (
          <Text style={s.primaryText}>
            {inProgressCustomUnpriced
              ? 'Set the price first'
              : inProgress
                ? 'Done ✓'
                : waiting.length > 0
                  ? 'Start next customer →'
                  : 'No one waiting'}
          </Text>
        )}
      </Pressable>

      <Text style={s.h2}>Up next · {waiting.length}</Text>
      {waiting.length === 0 && <Text style={s.muted}>No one waiting</Text>}
      {waiting.map((q, i) => {
        const pos = (inProgress ? 1 : 0) + i + 1;
        return (
          <View key={q.id} style={s.queueRow}>
            <View style={s.queueNumChip}>
              <Text style={s.queueNumText}>{pos}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: space.md }}>
              <Text style={s.queueName}>{q.customer_name}</Text>
              <Text style={s.queueService}>{q.services?.name ?? 'Custom service'}</Text>
            </View>
            <Pressable
              onPress={() => q.final_price_sen != null && openAdjust(q, 'add')}
              hitSlop={6}
            >
              <Text style={s.queuePrice}>
                {q.final_price_sen != null ? formatRM(q.final_price_sen) : 'Custom'}
              </Text>
            </Pressable>
            <Pressable
              style={s.rejectBtn}
              onPress={() => handleCancelEntry(q, 'waiting')}
              disabled={busy}
              hitSlop={8}
            >
              <Text style={s.rejectBtnText}>✕</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>

    <Modal
      visible={!!adjustTarget}
      animationType="fade"
      transparent
      onRequestClose={() => setAdjustTarget(null)}
    >
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <Text style={s.modalTitle}>Adjust price</Text>
          {adjustTarget && (
            <Text style={s.modalSub}>
              {adjustTarget.customer_name} · now {formatRM(adjustTarget.final_price_sen ?? 0)}
            </Text>
          )}

          <View style={s.modeToggle}>
            <Pressable
              style={[s.modeBtn, adjustMode === 'add' && s.modeBtnOn]}
              onPress={() => setAdjustMode('add')}
            >
              <Text style={[s.modeBtnText, adjustMode === 'add' && s.modeBtnTextOn]}>
                + Add charge
              </Text>
            </Pressable>
            <Pressable
              style={[s.modeBtn, adjustMode === 'reduce' && s.modeBtnOn]}
              onPress={() => setAdjustMode('reduce')}
            >
              <Text style={[s.modeBtnText, adjustMode === 'reduce' && s.modeBtnTextOn]}>
                − Reduce
              </Text>
            </Pressable>
          </View>

          <Text style={s.modalLabel}>Amount (RM)</Text>
          <TextInput
            style={s.modalInput}
            value={adjustText}
            onChangeText={setAdjustText}
            keyboardType="decimal-pad"
            placeholder="3.00"
            placeholderTextColor={colors.subtle}
            autoFocus
            onSubmitEditing={handleAdjustSubmit}
          />
          <Text style={s.modalHint}>
            Any discount re-applies to the new subtotal automatically.
          </Text>

          <View style={s.modalBtns}>
            <Pressable
              style={s.modalCancelBtn}
              onPress={() => setAdjustTarget(null)}
              disabled={adjustBusy}
            >
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.modalApplyBtn, adjustBusy && s.disabled]}
              onPress={handleAdjustSubmit}
              disabled={adjustBusy}
            >
              {adjustBusy ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={s.modalApplyText}>Apply</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  headerBtn: { paddingHorizontal: space.sm },
  headerBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2
  },

  h1: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6
  },
  h2: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.3,
    marginTop: space.sm
  },
  subtitle: { color: colors.muted, marginBottom: space.sm, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 14 },

  // Clock-in service cards
  serviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    ...cardShadow
  },
  serviceCardOn: {
    borderColor: colors.ok,
    borderWidth: 1.5,
    backgroundColor: colors.okSoft
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxOn: {
    backgroundColor: colors.ok,
    borderColor: colors.ok
  },
  checkmark: { fontSize: 12, fontWeight: '700', color: colors.primaryText },
  serviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.1
  },
  serviceMeta: { fontSize: 12, fontWeight: '500', color: colors.muted, marginTop: 2 },
  servicePrice: { fontSize: 16, fontWeight: '700', color: colors.text },

  primary: {
    backgroundColor: colors.ok,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: space.sm
  },
  primaryText: {
    color: colors.primaryText,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2
  },
  disabled: { opacity: 0.45 },

  // Shift status header
  shiftStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok },
  liveText: { color: colors.ok, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  shiftStatusText: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 3 },
  endShiftBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  endShiftText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2
  },

  // Break controls
  breakBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center'
  },
  breakBtnText: { color: colors.text, fontSize: 14, fontWeight: '600', letterSpacing: 0.2 },
  breakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.warnSoft,
    borderWidth: 1,
    borderColor: colors.warn,
    borderRadius: radius.md,
    padding: space.md
  },
  breakTitle: { color: colors.warn, fontSize: 14, fontWeight: '700', letterSpacing: 0.1 },
  breakSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  continueBtn: {
    backgroundColor: colors.ok,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  continueBtnText: { color: colors.primaryText, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },

  // Currently serving panel
  currentCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.ok,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 4,
    ...cardShadow
  },
  currentLabel: {
    color: colors.ok,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase'
  },
  currentName: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginTop: 2
  },
  currentMeta: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  receiptBtn: {
    backgroundColor: colors.whatsapp,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: space.md
  },
  receiptBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: 0.2
  },
  cancelInChairBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 8
  },
  cancelInChairText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 13,
    letterSpacing: 0.2
  },
  rejectBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: space.md
  },
  rejectBtnText: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 15
  },

  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    alignItems: 'center',
    ...cardShadow
  },

  // Up-next list rows
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    ...cardShadow
  },
  queueNumChip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 32,
    alignItems: 'center'
  },
  queueNumText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  queueName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.1
  },
  queueService: { fontSize: 12, color: colors.muted, fontWeight: '500', marginTop: 2 },
  queuePrice: { fontSize: 15, fontWeight: '700', color: colors.text },

  // Price adjustment (serving card)
  adjustNote: { fontSize: 12, color: colors.ok, fontStyle: 'italic', marginTop: 2 },
  adjustRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  adjustBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center'
  },
  adjustBtnText: { color: colors.text, fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },

  // Custom-service price entry
  customPriceRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  customPriceInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 16,
    color: colors.text
  },
  setPriceBtn: {
    backgroundColor: colors.ok,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96
  },
  setPriceBtnText: { color: colors.primaryText, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },

  // Price adjustment modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: space.lg
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
    ...cardShadow
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  modalSub: { fontSize: 13, color: colors.muted },
  modeToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    padding: 2,
    marginTop: space.xs
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent'
  },
  modeBtnOn: { backgroundColor: colors.surface, borderColor: colors.border },
  modeBtnText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  modeBtnTextOn: { color: colors.text },
  modalLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginTop: space.xs
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 16,
    color: colors.text
  },
  modalHint: { fontSize: 11, color: colors.subtle, fontStyle: 'italic', marginTop: 2 },
  modalBtns: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  modalCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center'
  },
  modalCancelText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  modalApplyBtn: {
    flex: 1,
    backgroundColor: colors.ok,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center'
  },
  modalApplyText: { color: colors.primaryText, fontSize: 14, fontWeight: '600', letterSpacing: 0.2 }
});
