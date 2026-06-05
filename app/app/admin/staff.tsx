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
import type { EmploymentType, Staff, StaffRole } from '@/lib/types';
import { cardShadow, colors, pageHeader, radius, space } from '@/lib/theme';

type EditableStaff = Partial<Staff> & {
  name?: string;
  phone?: string;
  email?: string;
  role?: StaffRole;
  employment_type?: EmploymentType;
  active?: boolean;
  password?: string; // only used when creating a new staff member
};

export default function AdminStaff() {
  const [list, setList] = useState<Staff[] | null>(null);
  const [editing, setEditing] = useState<EditableStaff | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('staff').select('*').order('name');
    if (error) Alert.alert('Error', error.message);
    setList((data as Staff[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave() {
    if (!editing) return;

    const isNew = !editing.id;
    const missingCore = !editing.name?.trim() || !editing.phone?.trim() || !editing.role;
    const missingEmailOnCreate = isNew && !editing.email?.trim();
    if (missingCore || missingEmailOnCreate) {
      Alert.alert(
        'Missing fields',
        isNew
          ? 'Name, phone, email, and role are required.'
          : 'Name, phone, and role are required.'
      );
      return;
    }

    // Creating a new staff: call the create-staff Edge Function which provisions
    // both the auth user and the staff row server-side using the service_role.
    if (isNew) {
      if (!editing.password || editing.password.length < 6) {
        Alert.alert('Password too short', 'Set a password of at least 6 characters.');
        return;
      }
      setBusy(true);
      const { data, error } = await supabase.functions.invoke('create-staff', {
        body: {
          name: editing.name!.trim(),
          phone: editing.phone!.trim(),
          email: editing.email!.trim().toLowerCase(),
          password: editing.password,
          role: editing.role,
          employment_type: editing.employment_type ?? 'commission',
          active: editing.active ?? true
        }
      });
      setBusy(false);
      if (error || (data as { error?: string })?.error) {
        const msg =
          (data as { error?: string })?.error ?? error?.message ?? 'Failed to create staff';
        Alert.alert('Error', msg);
        return;
      }
      setEditing(null);
      load();
      return;
    }

    // Editing existing: direct update (RLS policy permits admin).
    setBusy(true);
    const updatePayload: Record<string, unknown> = {
      name: editing.name!.trim(),
      phone: editing.phone!.trim(),
      role: editing.role,
      employment_type: editing.employment_type ?? 'commission',
      active: editing.active ?? true
    };
    // Only write email if the row has one OR the admin provided one for a row
    // that previously had no email (legacy rows from before migration 0005).
    if (editing.email?.trim()) {
      updatePayload.email = editing.email.trim().toLowerCase();
    }
    const { error } = await supabase
      .from('staff')
      .update(updatePayload)
      .eq('id', editing.id);
    setBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    setEditing(null);
    load();
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
          <Text style={pageHeader.subtitle}>Staff · {list.length} total</Text>
          <Text style={pageHeader.title}>Manage barbers</Text>
        </View>

        <Pressable
          style={s.addBtn}
          onPress={() =>
            setEditing({ name: '', phone: '', email: '', role: 'barber', active: true })
          }
        >
          <Text style={s.addBtnText}>+ Add staff</Text>
        </Pressable>

        {list.length === 0 && (
          <Text style={s.muted}>No staff yet. Tap "Add staff" to create the first one.</Text>
        )}

        {list.map((st) => (
          <Pressable
            key={st.id}
            onPress={() => setEditing({ ...st, email: st.email ?? undefined })}
            style={s.row}
          >
            <View style={{ flex: 1 }}>
              <View style={s.nameRow}>
                <Text style={s.name}>{st.name}</Text>
                <Text style={st.role === 'admin' ? s.roleAdmin : s.roleBarber}>
                  {st.role === 'admin' ? 'Admin' : 'Barber'}
                </Text>
              </View>
              <Text style={s.email}>
                {st.email ?? '—'} · {st.phone}
              </Text>
              <Text style={s.empType}>
                {(st.employment_type ?? 'commission') === 'full_time' ? 'Full-time' : 'Commission'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              {!st.active && <Text style={s.badgeRed}>Inactive</Text>}
              {st.role === 'admin' && !st.auth_user_id && (
                <Text style={s.badgeAmber}>No login</Text>
              )}
              <Text style={s.editLink}>Edit</Text>
            </View>
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
            <Text style={s.modalTitle}>{editing?.id ? 'Edit staff' : 'Add staff'}</Text>
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
              placeholder="Hafiz"
              placeholderTextColor={colors.subtle}
            />

            <Text style={s.label}>Phone</Text>
            <TextInput
              style={s.input}
              value={editing?.phone ?? ''}
              onChangeText={(v) => setEditing((e) => ({ ...e!, phone: v }))}
              keyboardType="phone-pad"
              placeholder="60123456789"
              placeholderTextColor={colors.subtle}
            />

            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={editing?.email ?? ''}
              onChangeText={(v) => setEditing((e) => ({ ...e!, email: v }))}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!editing?.id} // email locked once linked to an auth user
              placeholder="hafiz@novyx.my"
              placeholderTextColor={colors.subtle}
            />
            {editing?.id && (
              <Text style={s.helpText}>Email can't be changed after the account is created.</Text>
            )}

            {!editing?.id && (
              <>
                <Text style={s.label}>Temporary password</Text>
                <TextInput
                  style={s.input}
                  value={editing?.password ?? ''}
                  onChangeText={(v) => setEditing((e) => ({ ...e!, password: v }))}
                  secureTextEntry
                  autoCapitalize="none"
                  placeholder="At least 6 characters"
                  placeholderTextColor={colors.subtle}
                />
                <Text style={s.helpText}>
                  Hand this to the new staff member. They'll use it to sign in.
                </Text>
              </>
            )}

            <Text style={s.label}>Role</Text>
            <View style={s.pillRow}>
              {(['barber', 'admin'] as StaffRole[]).map((r) => {
                const on = editing?.role === r;
                return (
                  <Pressable
                    key={r}
                    style={[s.pill, on && s.pillOn]}
                    onPress={() => setEditing((e) => ({ ...e!, role: r }))}
                  >
                    <Text style={[s.pillText, on && s.pillTextOn]}>{r}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={s.label}>Employment type</Text>
            <View style={s.pillRow}>
              {(['full_time', 'commission'] as EmploymentType[]).map((t) => {
                const on = (editing?.employment_type ?? 'commission') === t;
                const label = t === 'full_time' ? 'Full-time' : 'Commission';
                return (
                  <Pressable
                    key={t}
                    style={[s.pill, on && s.pillOn]}
                    onPress={() => setEditing((e) => ({ ...e!, employment_type: t }))}
                  >
                    <Text style={[s.pillText, on && s.pillTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={s.activeRow}>
              <Text style={s.label}>Active</Text>
              <Switch
                value={editing?.active ?? true}
                onValueChange={(v) => setEditing((e) => ({ ...e!, active: v }))}
              />
            </View>

            {editing?.id && editing?.role === 'admin' && !editing?.auth_user_id && (
              <Text style={s.helpText}>
                This admin has no login linked. Recreate the row to provision one.
              </Text>
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
    gap: space.sm,
    ...cardShadow
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '600', color: colors.text, letterSpacing: -0.1 },
  roleAdmin: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.primaryText,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
    letterSpacing: 0.2
  },
  roleBarber: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
    letterSpacing: 0.2
  },
  email: { fontSize: 12, color: colors.muted, marginTop: 3 },
  empType: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.muted,
    letterSpacing: 0.2,
    marginTop: 2
  },
  editLink: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.2 },
  badgeRed: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.danger,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
    letterSpacing: 0.2
  },
  badgeAmber: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.warn,
    borderWidth: 1,
    borderColor: colors.warn,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
    letterSpacing: 0.2
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
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2
  },
  modalCancel: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  modalSave: { color: colors.text, fontSize: 14, fontWeight: '700' },
  modalBody: { padding: space.lg, gap: space.md },

  label: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
    letterSpacing: 0.4
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
  pillRow: { flexDirection: 'row', gap: space.sm },
  pill: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface
  },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2
  },
  pillTextOn: { color: colors.primaryText, fontWeight: '600' },
  activeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  helpText: {
    fontSize: 12,
    color: colors.muted,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md
  }
});
