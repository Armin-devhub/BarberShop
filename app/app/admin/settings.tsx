import { useState } from 'react';
import { Platform } from 'react-native';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';
import {
  getActiveBackend,
  initBackend,
  setActiveBackend,
  type Backend
} from '@/lib/supabase';
import { cardShadow, colors, pageHeader, radius, space } from '@/lib/theme';

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
        <Text style={pageHeader.subtitle}>Settings</Text>
        <Text style={pageHeader.title}>Database mode</Text>
      </View>

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

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },

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
