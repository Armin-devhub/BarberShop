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
import { supabase } from '@/lib/supabase';
import { formatRM, type Service } from '@/lib/types';
import { colors, pageHeader, radius, space, cardShadow } from '@/lib/theme';

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
  const [busy, setBusy] = useState(false);

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
    setEditing(null);
    load();
  }

  function openNew() {
    setEditing({ name: '', priceText: '', duration_minutes: 30, active: true });
  }

  function openEdit(svc: Service) {
    setEditing({
      id: svc.id,
      name: svc.name,
      priceText: (svc.price_sen / 100).toFixed(2),
      duration_minutes: svc.duration_minutes,
      active: svc.active
    });
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
        <View style={pageHeader.wrap}>
          <Text style={pageHeader.subtitle}>Services · {list.length} offered</Text>
          <Text style={pageHeader.title}>Cuts & treatments</Text>
        </View>

        <Pressable style={s.addBtn} onPress={openNew}>
          <Text style={s.addBtnText}>+ Add service</Text>
        </Pressable>

        {list.length === 0 && (
          <Text style={s.muted}>No services yet. Tap "Add service" to create one.</Text>
        )}

        {list.map((svc) => (
          <Pressable key={svc.id} onPress={() => openEdit(svc)} style={s.row}>
            <View style={{ flex: 1 }}>
              <View style={s.nameRow}>
                <Text style={s.name}>{svc.name}</Text>
                <Text style={s.durBadge}>~{svc.duration_minutes} min</Text>
                {!svc.active && <Text style={s.badgeRed}>Inactive</Text>}
              </View>
            </View>
            <Text style={s.price}>{formatRM(svc.price_sen)}</Text>
            <Text style={s.editLink}>Edit</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Modal
        visible={!!editing}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setEditing(null)}
      >
        <SafeAreaView style={s.modalContainer} edges={['top']}>
          <View style={s.modalHeader}>
            <Pressable onPress={() => setEditing(null)}>
              <Text style={s.modalCancel}>Cancel</Text>
            </Pressable>
            <Text style={s.modalTitle}>
              {editing?.id ? 'Edit service' : 'Add service'}
            </Text>
            <Pressable onPress={handleSave} disabled={busy}>
              <Text style={s.modalSave}>{busy ? '...' : 'Save'}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={s.modalBody}>
            <Text style={s.label}>Name</Text>
            <TextInput
              style={s.input}
              value={editing?.name ?? ''}
              onChangeText={(v) => setEditing((e) => ({ ...e!, name: v }))}
              placeholder="Buzz Cut"
              placeholderTextColor={colors.subtle}
            />

            <Text style={s.label}>Price (RM)</Text>
            <TextInput
              style={s.input}
              value={editing?.priceText ?? ''}
              onChangeText={(v) => setEditing((e) => ({ ...e!, priceText: v }))}
              keyboardType="decimal-pad"
              placeholder="25.00"
              placeholderTextColor={colors.subtle}
            />

            <Text style={s.label}>Duration (minutes)</Text>
            <TextInput
              style={s.input}
              value={String(editing?.duration_minutes ?? '')}
              onChangeText={(v) =>
                setEditing((e) => ({ ...e!, duration_minutes: parseInt(v, 10) || 0 }))
              }
              keyboardType="number-pad"
              placeholder="30"
              placeholderTextColor={colors.subtle}
            />

            <View style={s.activeRow}>
              <Text style={s.label}>Active</Text>
              <Switch
                value={editing?.active ?? true}
                onValueChange={(v) => setEditing((e) => ({ ...e!, active: v }))}
                trackColor={{ false: colors.border, true: colors.text }}
                thumbColor="#fff"
              />
            </View>
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
  muted: { color: colors.muted, textAlign: 'center', marginTop: space.lg, fontSize: 13 },
  addBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: space.sm
  },
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '600', color: colors.text, letterSpacing: -0.1 },
  durBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
    letterSpacing: 0.3
  },
  price: { fontSize: 16, fontWeight: '700', color: colors.text },
  editLink: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.2 },
  badgeRed: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.danger,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
    letterSpacing: 0.3
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
  activeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  }
});
