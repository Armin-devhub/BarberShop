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
import { supabase, deleteStaff, countStaffBookings } from '@/lib/supabase';
import type { EmploymentType, Staff, StaffRole } from '@/lib/types';
import { cardShadow, colors, pageHeader, radius, space } from '@/lib/theme';
import { DeleteRowButton } from '@/lib/DeleteRowButton';
import { useAuth } from '@/lib/auth';

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
  const { staff: me } = useAuth();
  const [list, setList] = useState<Staff[] | null>(null);
  const [editing, setEditing] = useState<EditableStaff | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  function open(next: EditableStaff) {
    setEditing(next);
    setVisible(true);
  }
  // Hide first; keep `editing` so the modal keeps its content while it
  // animates closed (otherwise it flashes the empty "Add" state).
  function close() {
    setVisible(false);
  }

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
      close();
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
    close();
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
        <View style={s.headerRow}>
          <View style={pageHeader.wrap}>
            <Text style={pageHeader.subtitle}>Staff · {list.length} total</Text>
            <Text style={pageHeader.title}>Manage Barbers</Text>
          </View>
          <Pressable
            style={({ pressed }) => [s.addBtnSm, pressed && s.addBtnPressed]}
            onPress={() => open({ name: '', phone: '', email: '', role: 'barber', active: true })}
          >
            <Ionicons name="add" size={18} color={colors.primaryText} />
            <Text style={s.addBtnText}>Add</Text>
          </Pressable>
        </View>

        {list.length === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Ionicons name="people-outline" size={26} color={colors.subtle} />
            </View>
            <Text style={s.emptyTitle}>No staff yet</Text>
            <Text style={s.emptyText}>Add your first barber or admin to get started.</Text>
            <Pressable
              style={({ pressed }) => [s.emptyBtn, pressed && s.addBtnPressed]}
              onPress={() => open({ name: '', phone: '', email: '', role: 'barber', active: true })}
            >
              <Ionicons name="add" size={18} color={colors.primaryText} />
              <Text style={s.addBtnText}>Add staff</Text>
            </Pressable>
          </View>
        ) : (
          list.map((st) => {
            const noLogin = st.role === 'admin' && !st.auth_user_id;
            return (
              <Pressable
                key={st.id}
                onPress={() => open({ ...st, email: st.email ?? undefined })}
                style={({ pressed }) => [s.row, !st.active && s.rowInactive, pressed && s.rowPressed]}
              >
                <View style={[s.avatar, st.role === 'admin' && s.avatarAdmin]}>
                  <Text style={[s.avatarText, st.role === 'admin' && s.avatarTextAdmin]}>
                    {st.name.trim().charAt(0).toUpperCase() || '?'}
                  </Text>
                </View>
                <View style={s.rowMid}>
                  <View style={s.nameRow}>
                    <Text style={s.name} numberOfLines={1}>
                      {st.name}
                    </Text>
                    <Text style={st.role === 'admin' ? s.roleAdmin : s.roleBarber}>
                      {st.role === 'admin' ? 'Admin' : 'Barber'}
                    </Text>
                    {!st.active && <Text style={s.badgeRed}>Inactive</Text>}
                  </View>
                  <Text style={s.email} numberOfLines={1}>
                    {st.email ?? '—'} · {st.phone}
                  </Text>
                  <View style={s.subRow}>
                    <Text style={s.empType}>
                      {(st.employment_type ?? 'commission') === 'full_time'
                        ? 'Full-time'
                        : 'Commission'}
                    </Text>
                    {noLogin && (
                      <>
                        <Text style={s.subDot}>·</Text>
                        <Text style={s.noLogin}>No login</Text>
                      </>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.subtle} />
              </Pressable>
            );
          })
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
            <Text style={s.modalTitle}>{editing?.id ? 'Edit staff' : 'Add staff'}</Text>
            <Pressable
              onPress={handleSave}
              disabled={busy}
              style={({ pressed }) => [s.saveBtn, busy && s.saveBtnDisabled, pressed && s.addBtnPressed]}
            >
              <Text style={s.saveBtnText}>{busy ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={s.modalBody}>
            {/* Live preview */}
            <View style={s.previewCard}>
              <View style={[s.avatarLg, editing?.role === 'admin' && s.avatarAdmin]}>
                <Text style={[s.avatarTextLg, editing?.role === 'admin' && s.avatarTextAdmin]}>
                  {editing?.name?.trim().charAt(0).toUpperCase() || '?'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.previewName} numberOfLines={1}>
                  {editing?.name?.trim() || 'New staff'}
                </Text>
                <Text style={s.email} numberOfLines={1}>
                  {editing?.email?.trim() || '—'}
                  {editing?.phone?.trim() ? ` · ${editing.phone.trim()}` : ''}
                </Text>
              </View>
              <Text style={editing?.role === 'admin' ? s.roleAdmin : s.roleBarber}>
                {editing?.role === 'admin' ? 'Admin' : 'Barber'}
              </Text>
            </View>

            <View style={s.formCard}>
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
                    <Text style={[s.pillText, on && s.pillTextOn]}>
                      {r === 'admin' ? 'Admin' : 'Barber'}
                    </Text>
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

            <View style={s.activeRowDivided}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>Active</Text>
                <Text style={s.helper}>Inactive staff can't start a shift.</Text>
              </View>
              <Switch
                value={editing?.active ?? true}
                onValueChange={(v) => setEditing((e) => ({ ...e!, active: v }))}
              />
            </View>
            </View>

            {editing?.id && editing?.role === 'admin' && !editing?.auth_user_id && (
              <Text style={s.helpText}>
                This admin has no login linked. Recreate the row to provision one.
              </Text>
            )}

            {editing?.id && editing.id !== me?.id && (
              <DeleteRowButton
                label="staff member"
                name={editing.name?.trim() || 'this staff member'}
                onConfirm={() => deleteStaff(editing.id!)}
                onDeleted={() => {
                  close();
                  load();
                }}
                getImpact={async () => {
                  const n = await countStaffBookings(editing.id!);
                  const base =
                    'Their login is removed and their shifts, breaks and pay records are permanently deleted.';
                  return n > 0
                    ? `${base} ${n} past booking${n === 1 ? '' : 's'} tied to them will also be deleted from your reports.`
                    : base;
                }}
              />
            )}
            {editing?.id && editing.id === me?.id && (
              <Text style={s.helpText}>You can't delete your own account.</Text>
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
  },

  // ===== Modern list/modal additions =====
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  addBtnSm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.md
  },
  addBtnPressed: { opacity: 0.85 },
  rowInactive: { opacity: 0.55 },
  rowPressed: { backgroundColor: colors.surfaceAlt },
  rowMid: { flex: 1, gap: 3 },

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarAdmin: { backgroundColor: colors.text },
  avatarText: { fontSize: 16, fontWeight: '800', color: colors.accentDeep },
  avatarTextAdmin: { color: colors.primaryText },

  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  subDot: { fontSize: 11, color: colors.subtle },
  noLogin: { fontSize: 11, fontWeight: '700', color: colors.warn, letterSpacing: 0.2 },

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

  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: colors.primaryText, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },

  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    ...cardShadow
  },
  avatarLg: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarTextLg: { fontSize: 20, fontWeight: '800', color: colors.accentDeep },
  previewName: { fontSize: 16, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },

  formCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    ...cardShadow
  },
  activeRowDivided: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: space.md
  },
  helper: { fontSize: 11, color: colors.subtle, marginTop: 2 }
});
