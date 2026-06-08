import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';
import {
  cleanDatabase,
  getActiveBackend,
  getShopCloseTime,
  initBackend,
  setActiveBackend,
  setShopCloseTime,
  type Backend,
  type CleanDatabaseResult
} from '@/lib/supabase';
import { cardShadow, colors, pageHeader, radius, space } from '@/lib/theme';

// "HH:MM" (24h) -> "h:MM AM/PM" for display.
function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

const META: Record<Backend, { title: string; blurb: string }> = {
  live: {
    title: 'Live',
    blurb: 'The real shop — real customers, real bookings, real money.'
  },
  mock: {
    title: 'Test mode',
    blurb: 'A separate practice database. Nothing here touches the real shop — safe to experiment, demo, or train staff.'
  }
};

export default function AdminSettings() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [current] = useState<Backend>(getActiveBackend());
  const [target, setTarget] = useState<Backend | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Shop closing time (Malaysia time, "HH:MM").
  const [closeTime, setCloseTime] = useState('00:00');
  const [savedTime, setSavedTime] = useState('00:00'); // last persisted value
  const [loadingTime, setLoadingTime] = useState(true);
  const [savingTime, setSavingTime] = useState(false);
  const [timeError, setTimeError] = useState('');
  const [timeSaved, setTimeSaved] = useState(false);

  const loadCloseTime = useCallback(async () => {
    setLoadingTime(true);
    try {
      const t = await getShopCloseTime();
      setCloseTime(t);
      setSavedTime(t);
    } catch {
      // leave default
    } finally {
      setLoadingTime(false);
    }
  }, []);

  useEffect(() => {
    loadCloseTime();
  }, [loadCloseTime]);

  function bump(unit: 'h' | 'm', delta: number) {
    setTimeSaved(false);
    setTimeError('');
    const [h, m] = closeTime.split(':').map((n) => parseInt(n, 10));
    let nh = h;
    let nm = m;
    if (unit === 'h') nh = (h + delta + 24) % 24;
    else nm = (m + delta + 60) % 60;
    setCloseTime(`${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`);
  }

  async function saveCloseTime() {
    setSavingTime(true);
    setTimeError('');
    setTimeSaved(false);
    try {
      await setShopCloseTime(closeTime);
      setSavedTime(closeTime);
      setTimeSaved(true);
    } catch (e) {
      setTimeError(e instanceof Error ? e.message : 'Could not save closing time.');
    } finally {
      setSavingTime(false);
    }
  }

  const timeDirty = closeTime !== savedTime;

  // Clean database (danger zone).
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState('');
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState('');
  const [wipeResult, setWipeResult] = useState<CleanDatabaseResult | null>(null);

  function openWipe() {
    setWipeConfirm('');
    setWipeError('');
    setWipeResult(null);
    setWipeOpen(true);
  }

  async function confirmWipe() {
    setWiping(true);
    setWipeError('');
    try {
      const result = await cleanDatabase(wipeConfirm.trim());
      setWipeResult(result);
    } catch (e) {
      setWipeError(e instanceof Error ? e.message : 'Could not clean the database.');
    } finally {
      setWiping(false);
    }
  }

  async function confirmSwitch() {
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      await setActiveBackend(target);
      await initBackend(); // swap the active client immediately
      setTarget(null);
      // The old session belongs to the previous backend — drop it and force a
      // fresh login against the now-active backend.
      await signOut();
      if (Platform.OS === 'web') {
        // Hard reload so every open tab/page re-reads the flag cleanly.
        (globalThis as { location?: { reload: () => void } }).location?.reload();
      } else {
        router.replace('/login');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch backend.');
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.scrollContent}>
      <View style={pageHeader.wrap}>
        <Text style={pageHeader.subtitle}>Admin</Text>
        <Text style={pageHeader.title}>Settings</Text>
      </View>

      {/* ===== Shop closing time ===== */}
      <Text style={[s.sectionLabel, { marginTop: 0 }]}>Shop closing time</Text>
      <View style={s.timeCard}>
        <Text style={s.infoText}>
          Any barber still clocked in (or on a break) at this time is automatically
          ended, so forgotten clock-outs don't inflate their hours. Malaysia time.
        </Text>

        {loadingTime ? (
          <ActivityIndicator color={colors.text} style={{ marginVertical: space.md }} />
        ) : (
          <>
            <View style={s.timePreviewRow}>
              <Ionicons name="moon-outline" size={18} color={colors.muted} />
              <Text style={s.timePreview}>{to12h(closeTime)}</Text>
            </View>

            <View style={s.stepperRow}>
              <Stepper
                label="Hour"
                value={String(closeTime.split(':')[0]).padStart(2, '0')}
                onDown={() => bump('h', -1)}
                onUp={() => bump('h', 1)}
              />
              <Stepper
                label="Minute"
                value={String(closeTime.split(':')[1]).padStart(2, '0')}
                onDown={() => bump('m', -5)}
                onUp={() => bump('m', 5)}
              />
            </View>

            {timeError ? <Text style={s.modalError}>{timeError}</Text> : null}
            {timeSaved && !timeDirty ? (
              <Text style={s.savedNote}>✓ Saved — auto-end now fires at {to12h(closeTime)}.</Text>
            ) : null}

            <Pressable
              disabled={!timeDirty || savingTime}
              onPress={saveCloseTime}
              style={[s.saveBtn, (!timeDirty || savingTime) && s.saveBtnDisabled]}
            >
              {savingTime ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={s.saveBtnText}>{timeDirty ? 'Save closing time' : 'Saved'}</Text>
              )}
            </Pressable>
          </>
        )}
      </View>

      {/* ===== Database mode ===== */}
      <Text style={s.sectionLabel}>Database mode</Text>
      <View style={s.infoCard}>
        <Text style={s.infoText}>
          This screen chooses which database the whole system runs on — both this
          app and the customer website.
        </Text>
        <Text style={s.infoText}>
          <Text style={s.infoStrong}>Live</Text> is your real shop. {' '}
          <Text style={s.infoStrong}>Test mode</Text> is a separate sandbox with
          its own data — use it to try things, give a demo, or train staff without
          affecting real customers or bookings.
        </Text>
        <Text style={s.infoText}>
          Switching here applies to <Text style={s.infoStrong}>everyone</Text>, so
          remember to switch back to Live when you're done testing.
        </Text>
      </View>

      <View style={s.statusCard}>
        <Text style={s.statusLabel}>Currently active</Text>
        <View style={s.statusRow}>
          <View style={[s.dot, current === 'live' ? s.dotLive : s.dotMock]} />
          <Text style={s.statusValue}>{META[current].title}</Text>
        </View>
        <Text style={s.statusBlurb}>{META[current].blurb}</Text>
      </View>

      <Text style={s.sectionLabel}>Switch to</Text>
      {(['live', 'mock'] as Backend[]).map((b) => {
        const isCurrent = b === current;
        return (
          <Pressable
            key={b}
            disabled={isCurrent}
            onPress={() => setTarget(b)}
            style={[s.option, isCurrent && s.optionDisabled]}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.optionTitle}>{META[b].title}</Text>
              <Text style={s.optionBlurb}>{META[b].blurb}</Text>
            </View>
            {isCurrent ? (
              <Text style={s.activeTag}>ACTIVE</Text>
            ) : (
              <Text style={s.switchTag}>Switch →</Text>
            )}
          </Pressable>
        );
      })}

      <Text style={s.note}>
        Switching signs you out. Open apps and the website pick up the change the
        next time they load.
      </Text>

      {/* ===== Danger zone ===== */}
      <Text style={[s.sectionLabel, s.dangerLabel]}>Danger zone</Text>
      <View style={s.dangerCard}>
        <Text style={s.dangerTitle}>Clean database</Text>
        <Text style={s.infoText}>
          Permanently deletes <Text style={s.infoStrong}>all</Text> staff, services,
          products, discounts, and every customer, queue, shift and pay record — on
          the currently active <Text style={s.infoStrong}>{META[current].title}</Text>{' '}
          database. Only your admin account survives. This cannot be undone.
        </Text>
        <Pressable onPress={openWipe} style={s.dangerBtn}>
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
          <Text style={s.dangerBtnText}>Clean database…</Text>
        </Pressable>
      </View>

      {/* Wipe confirmation */}
      <Modal visible={wipeOpen} transparent animationType="fade" onRequestClose={() => setWipeOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            {wipeResult ? (
              <>
                <Text style={s.modalTitle}>✓ Database cleaned</Text>
                <Text style={s.modalBody}>
                  Removed {wipeResult.deleted_staff} staff, {wipeResult.deleted_services} services,{' '}
                  {wipeResult.deleted_products} products and {wipeResult.deleted_customers} customer
                  records. Your admin account was kept.
                </Text>
                <View style={s.modalActions}>
                  <Pressable onPress={() => setWipeOpen(false)} style={[s.modalBtn, s.modalConfirm]}>
                    <Text style={s.modalConfirmText}>Done</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={s.modalTitle}>⚠ Erase the {META[current].title} database?</Text>
                <Text style={s.modalBody}>
                  This permanently deletes everything except your admin account on the{' '}
                  <Text style={s.infoStrong}>{META[current].title}</Text> database. There is no
                  undo. Type <Text style={s.eraseWord}>ERASE</Text> to confirm.
                </Text>
                <TextInput
                  value={wipeConfirm}
                  onChangeText={setWipeConfirm}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="ERASE"
                  placeholderTextColor={colors.subtle}
                  editable={!wiping}
                  style={s.wipeInput}
                />
                {wipeError ? <Text style={s.modalError}>{wipeError}</Text> : null}
                <View style={s.modalActions}>
                  <Pressable
                    disabled={wiping}
                    onPress={() => setWipeOpen(false)}
                    style={[s.modalBtn, s.modalCancel]}
                  >
                    <Text style={s.modalCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    disabled={wiping || wipeConfirm.trim() !== 'ERASE'}
                    onPress={confirmWipe}
                    style={[
                      s.modalBtn,
                      s.modalConfirm,
                      (wiping || wipeConfirm.trim() !== 'ERASE') && s.saveBtnDisabled
                    ]}
                  >
                    {wiping ? (
                      <ActivityIndicator color={colors.bg} />
                    ) : (
                      <Text style={s.modalConfirmText}>Erase everything</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Confirmation */}
      <Modal visible={target !== null} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>⚠ Switch to {target ? META[target].title : ''}?</Text>
            <Text style={s.modalBody}>
              This affects the customer website and the app for everyone. You'll be
              signed out and must log in again to the {target ? META[target].title : ''} backend.
            </Text>
            {error ? <Text style={s.modalError}>{error}</Text> : null}
            <View style={s.modalActions}>
              <Pressable
                disabled={busy}
                onPress={() => {
                  setError('');
                  setTarget(null);
                }}
                style={[s.modalBtn, s.modalCancel]}
              >
                <Text style={s.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={confirmSwitch} style={[s.modalBtn, s.modalConfirm]}>
                {busy ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <Text style={s.modalConfirmText}>Switch</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Stepper({
  label,
  value,
  onUp,
  onDown
}: {
  label: string;
  value: string;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <View style={s.stepper}>
      <Text style={s.stepperLabel}>{label}</Text>
      <View style={s.stepperControl}>
        <Pressable onPress={onDown} hitSlop={6} style={s.stepperBtn}>
          <Ionicons name="remove" size={20} color={colors.text} />
        </Pressable>
        <Text style={s.stepperValue}>{value}</Text>
        <Pressable onPress={onUp} hitSlop={6} style={s.stepperBtn}>
          <Ionicons name="add" size={20} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },

  timeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
    ...cardShadow
  },
  timePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4
  },
  timePreview: { fontSize: 30, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  stepperRow: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  stepper: {
    flex: 1,
    alignItems: 'center',
    gap: 6
  },
  stepperLabel: {
    fontSize: 10,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600'
  },
  stepperControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 4,
    width: '100%'
  },
  stepperBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepperValue: { fontSize: 22, fontWeight: '700', color: colors.text, minWidth: 36, textAlign: 'center' },
  savedNote: { fontSize: 12, color: colors.ok, fontWeight: '600' },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: colors.bg },

  dangerLabel: { color: colors.danger },
  dangerCard: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm
  },
  dangerTitle: { fontSize: 15, fontWeight: '800', color: colors.danger },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    paddingVertical: 11,
    backgroundColor: colors.surface
  },
  dangerBtnText: { fontSize: 14, fontWeight: '700', color: colors.danger },
  eraseWord: { fontWeight: '800', color: colors.danger, letterSpacing: 1 },
  wipeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    textAlign: 'center'
  },

  infoCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: 8,
    ...cardShadow
  },
  infoText: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  infoStrong: { color: colors.text, fontWeight: '700' },

  statusCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    ...cardShadow
  },
  statusLabel: {
    fontSize: 10,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600'
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotLive: { backgroundColor: colors.ok },
  dotMock: { backgroundColor: colors.muted },
  statusValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  statusBlurb: { fontSize: 12, color: colors.muted, marginTop: 4 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.4,
    marginTop: space.md,
    marginBottom: 2
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    ...cardShadow
  },
  optionDisabled: { opacity: 0.55 },
  optionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  optionBlurb: { fontSize: 12, color: colors.muted, marginTop: 2 },
  activeTag: { fontSize: 11, fontWeight: '700', color: colors.ok, letterSpacing: 0.5 },
  switchTag: { fontSize: 13, fontWeight: '600', color: colors.text },

  note: {
    fontSize: 12,
    color: colors.subtle,
    fontStyle: 'italic',
    marginTop: space.sm,
    lineHeight: 17
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  modalBody: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  modalError: { fontSize: 12, color: colors.danger },
  modalActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalCancel: { borderWidth: 1, borderColor: colors.border },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  modalConfirm: { backgroundColor: colors.danger },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: colors.bg }
});
