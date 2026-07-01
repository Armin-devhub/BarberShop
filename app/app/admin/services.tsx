import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase, deleteService, countServiceBookings } from '@/lib/supabase';
import { formatRM, type Service } from '@/lib/types';
import { colors, pageHeader, radius, space, cardShadow } from '@/lib/theme';
import { DeleteRowButton } from '@/lib/DeleteRowButton';

const DURATION_PRESETS = [15, 30, 45, 60];

interface EditableService {
  id?: string;
  name?: string;
  priceText?: string;
  duration_minutes?: number;
  active?: boolean;
}

export default function AdminServices() {
  const [list, setList] = useState<Service[] | null>(null);
  const [editing, setEditing] = useState<EditableService | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Hide first; keep `editing` so the modal keeps its content while it animates
  // closed (otherwise it flashes the empty "Add" state).
  function close() {
    setVisible(false);
  }

  async function load() {
    const { data, error } = await supabase.from('services').select('*').order('price_sen');
    if (error) Alert.alert('Error', error.message);
    setList((data as Service[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave() {
    if (!editing) return;
    const name = editing.name?.trim();
    const priceFloat = parseFloat((editing.priceText ?? '').replace(',', '.'));
    const duration = editing.duration_minutes ?? 30;

    if (!name) {
      Alert.alert('Missing field', 'Name is required.');
      return;
    }
    if (!Number.isFinite(priceFloat) || priceFloat < 0) {
      Alert.alert('Invalid price', 'Enter a price like 25 or 25.50.');
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      Alert.alert('Invalid duration', 'Duration must be a positive number of minutes.');
      return;
    }

    setBusy(true);
    const payload = {
      name,
      price_sen: Math.round(priceFloat * 100),
      duration_minutes: duration,
      active: editing.active ?? true
    };
    const { error } = editing.id
      ? await supabase.from('services').update(payload).eq('id', editing.id)
      : await supabase.from('services').insert(payload);
    setBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    close();
    load();
  }

  function openNew() {
    setEditing({ name: '', priceText: '', duration_minutes: 30, active: true });
    setVisible(true);
  }

  function openEdit(svc: Service) {
    setEditing({
      id: svc.id,
      name: svc.name,
      priceText: (svc.price_sen / 100).toFixed(2),
      duration_minutes: svc.duration_minutes,
      active: svc.active
    });
    setVisible(true);
  }

  if (!list) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  return (
    <View style={s.flex}>
      <ScrollView contentContainerStyle={s.scrollContent}>
        <View style={s.headerRow}>
          <View style={pageHeader.wrap}>
            <Text style={pageHeader.subtitle}>Services · {list.length} offered</Text>
            <Text style={pageHeader.title}>Cuts & Treatments</Text>
          </View>
          <Pressable style={({ pressed }) => [s.addBtn, pressed && s.addBtnPressed]} onPress={openNew}>
            <Ionicons name="add" size={18} color={colors.primaryText} />
            <Text style={s.addBtnText}>Add</Text>
          </Pressable>
        </View>

        {list.length === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Ionicons name="cut-outline" size={26} color={colors.subtle} />
            </View>
            <Text style={s.emptyTitle}>No services yet</Text>
            <Text style={s.emptyText}>Add your first cut or treatment to start the menu.</Text>
            <Pressable style={({ pressed }) => [s.emptyBtn, pressed && s.addBtnPressed]} onPress={openNew}>
              <Ionicons name="add" size={18} color={colors.primaryText} />
              <Text style={s.addBtnText}>Add service</Text>
            </Pressable>
          </View>
        ) : (
          list.map((svc) => (
            <Pressable
              key={svc.id}
              onPress={() => openEdit(svc)}
              style={({ pressed }) => [s.row, !svc.active && s.rowInactive, pressed && s.rowPressed]}
            >
              <View style={s.iconChip}>
                <Ionicons name="cut-outline" size={18} color={colors.accentDeep} />
              </View>
              <View style={s.rowMid}>
                <Text style={s.name} numberOfLines={1}>
                  {svc.name}
                </Text>
                <View style={s.subRow}>
                  <Text style={s.sub}>~{svc.duration_minutes} min</Text>
                  <Text style={s.subDot}>·</Text>
                  <Text style={[s.sub, svc.active ? s.subActive : s.subInactive]}>
                    {svc.active ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
              <Text style={s.price}>{formatRM(svc.price_sen)}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={close}
      >
        <SafeAreaView style={s.modalContainer} edges={['top']}>
          <View style={s.modalHeader}>
            <Pressable onPress={close} hitSlop={8}>
              <Text style={s.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={s.modalTitle}>
              {editing?.id ? 'Edit service' : 'Add service'}
            </Text>
            <Pressable
              onPress={handleSave}
              disabled={busy}
              style={({ pressed }) => [s.saveBtn, busy && s.saveBtnDisabled, pressed && s.addBtnPressed]}
            >
              <Text style={s.saveBtnText}>{busy ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={s.modalBody}>
            {/* Live preview of the list row */}
            <Text style={s.previewLabel}>PREVIEW</Text>
            <View style={[s.row, !(editing?.active ?? true) && s.rowInactive]}>
              <View style={s.iconChip}>
                <Ionicons name="cut-outline" size={18} color={colors.accentDeep} />
              </View>
              <View style={s.rowMid}>
                <Text style={s.name} numberOfLines={1}>
                  {editing?.name?.trim() || 'New service'}
                </Text>
                <View style={s.subRow}>
                  <Text style={s.sub}>~{editing?.duration_minutes || 0} min</Text>
                  <Text style={s.subDot}>·</Text>
                  <Text style={[s.sub, (editing?.active ?? true) ? s.subActive : s.subInactive]}>
                    {(editing?.active ?? true) ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
              <Text style={s.price}>
                {formatRM(Math.round((parseFloat((editing?.priceText ?? '').replace(',', '.')) || 0) * 100))}
              </Text>
            </View>

            <View style={s.formCard}>
              <Text style={s.label}>Name</Text>
              <TextInput
                style={s.input}
                value={editing?.name ?? ''}
                onChangeText={(v) => setEditing((e) => ({ ...e!, name: v }))}
                placeholder="Buzz Cut"
                placeholderTextColor={colors.subtle}
              />

              <Text style={s.label}>Price</Text>
              <View style={s.priceField}>
                <Text style={s.pricePrefix}>RM</Text>
                <TextInput
                  style={s.priceInput}
                  value={editing?.priceText ?? ''}
                  onChangeText={(v) => setEditing((e) => ({ ...e!, priceText: v }))}
                  keyboardType="decimal-pad"
                  placeholder="25.00"
                  placeholderTextColor={colors.subtle}
                />
              </View>

              <Text style={s.label}>Duration (minutes)</Text>
              <View style={s.chipRow}>
              {DURATION_PRESETS.map((min) => {
                const on = editing?.duration_minutes === min;
                return (
                  <Pressable
                    key={min}
                    onPress={() => setEditing((e) => ({ ...e!, duration_minutes: min }))}
                    style={[s.chip, on && s.chipOn]}
                  >
                    <Text style={[s.chipText, on && s.chipTextOn]}>{min}</Text>
                  </Pressable>
                );
              })}
              <TextInput
                style={[s.input, s.chipInput]}
                value={
                  DURATION_PRESETS.includes(editing?.duration_minutes ?? -1)
                    ? ''
                    : String(editing?.duration_minutes ?? '')
                }
                onChangeText={(v) =>
                  setEditing((e) => ({ ...e!, duration_minutes: parseInt(v, 10) || 0 }))
                }
                keyboardType="number-pad"
                placeholder="Custom"
                placeholderTextColor={colors.subtle}
              />
            </View>

              <View style={s.activeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Active</Text>
                  <Text style={s.helper}>Hidden from the queue when off.</Text>
                </View>
                <Switch
                  value={editing?.active ?? true}
                  onValueChange={(v) => setEditing((e) => ({ ...e!, active: v }))}
                  trackColor={{ false: colors.border, true: colors.text }}
                  thumbColor="#fff"
                />
              </View>
            </View>

            {editing?.id && (
              <DeleteRowButton
                label="service"
                name={editing.name?.trim() || 'this service'}
                onConfirm={async () => {
                  await deleteService(editing.id!);
                }}
                onDeleted={() => {
                  close();
                  load();
                }}
                getImpact={async () => {
                  const n = await countServiceBookings(editing.id!);
                  return n > 0
                    ? `This service was used in ${n} past booking${n === 1 ? '' : 's'} — those bookings will also be permanently deleted from your reports.`
                    : 'This service has never been used, so no bookings are affected.';
                }}
              />
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.md
  },
  addBtnPressed: { opacity: 0.85 },
  addBtnText: { color: colors.primaryText, fontWeight: '600', letterSpacing: 0.2, fontSize: 14 },

  row: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    ...cardShadow
  },
  rowInactive: { opacity: 0.55 },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rowMid: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text, letterSpacing: -0.1 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sub: { fontSize: 11, fontWeight: '600', color: colors.muted, letterSpacing: 0.2 },
  subDot: { fontSize: 11, color: colors.subtle },
  subActive: { color: colors.ok },
  subInactive: { color: colors.danger },
  price: { fontSize: 16, fontWeight: '700', color: colors.text },

  empty: { alignItems: 'center', paddingVertical: space.xl, gap: space.sm },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: 'center', maxWidth: 260 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    marginTop: space.sm
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
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: colors.primaryText, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  modalBody: { padding: space.lg, gap: space.md },

  previewLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    letterSpacing: 1.2,
    marginBottom: -space.xs
  },
  formCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    marginTop: space.xs,
    ...cardShadow
  },

  label: { fontSize: 11, color: colors.muted, fontWeight: '600', letterSpacing: 0.4 },
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
  priceField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface
  },
  pricePrefix: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
    paddingLeft: space.md,
    paddingRight: space.sm,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: 11
  },
  priceInput: {
    flex: 1,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  chip: {
    minWidth: 46,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center'
  },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  chipTextOn: { color: colors.primaryText },
  chipInput: { flex: 1, minWidth: 80, paddingVertical: 9, textAlign: 'center' },
  helper: { fontSize: 11, color: colors.subtle, marginTop: 2 },
  activeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md
  }
});
