import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from './theme';

interface Props {
  /** Lowercase noun for the row, e.g. "service", "product", "discount code", "staff member". */
  label: string;
  /** Display name shown in the confirmation (row name/code). */
  name: string;
  /** Runs the delete. MUST throw an Error (with a message) on failure. */
  onConfirm: () => Promise<void>;
  /** Called after a successful delete — typically close the edit modal + reload. */
  onDeleted: () => void;
  /**
   * Optional. Fetched when the dialog opens; returns a sentence describing the
   * history that will be affected (e.g. "…12 past bookings will also be deleted").
   */
  getImpact?: () => Promise<string | null>;
}

// Delete trigger + its own confirmation dialog. Deliberately uses an in-app Modal
// rather than Alert.alert, because Alert is unreliable on the web PWA (the same
// reason a failed action can look like "nothing happened").
export function DeleteRowButton({ label, name, onConfirm, onDeleted, getImpact }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [impact, setImpact] = useState<string | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  async function openDialog() {
    setError('');
    setImpact(null);
    setOpen(true);
    if (getImpact) {
      setLoadingImpact(true);
      try {
        setImpact(await getImpact());
      } catch {
        setImpact(null);
      } finally {
        setLoadingImpact(false);
      }
    }
  }

  async function run() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Pressable onPress={openDialog} style={({ pressed }) => [s.trigger, pressed && s.pressed]}>
        <Ionicons name="trash-outline" size={16} color={colors.danger} />
        <Text style={s.triggerText}>Delete {label}</Text>
      </Pressable>

      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => !busy && setOpen(false)}
      >
        <View style={s.backdrop}>
          <View style={s.card}>
            <Text style={s.title}>Delete {name || label}?</Text>
            <Text style={s.body}>
              This permanently deletes the {label}. This cannot be undone.
            </Text>
            {loadingImpact ? (
              <ActivityIndicator color={colors.muted} style={{ marginVertical: 4 }} />
            ) : impact ? (
              <Text style={s.impact}>{impact}</Text>
            ) : null}
            {error ? <Text style={s.error}>{error}</Text> : null}
            <View style={s.actions}>
              <Pressable
                disabled={busy}
                onPress={() => setOpen(false)}
                style={[s.btn, s.cancel]}
              >
                <Text style={s.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={run}
                style={[s.btn, s.confirm, busy && s.disabled]}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={s.confirmText}>Delete</Text>
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
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    marginTop: space.sm
  },
  pressed: { opacity: 0.85 },
  triggerText: { fontSize: 14, fontWeight: '700', color: colors.danger, letterSpacing: 0.2 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  body: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  impact: {
    fontSize: 13,
    color: colors.danger,
    fontWeight: '600',
    lineHeight: 19,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    padding: space.sm
  },
  error: { fontSize: 12, color: colors.danger },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cancel: { borderWidth: 1, borderColor: colors.border },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  confirm: { backgroundColor: colors.danger },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  disabled: { opacity: 0.5 }
});
