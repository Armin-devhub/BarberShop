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
import { supabase, deleteDiscount, countDiscountBookings } from '@/lib/supabase';
import type { DiscountCode } from '@/lib/types';
import { colors, pageHeader, radius, space } from '@/lib/theme';
import { adminUI as s } from '@/lib/adminUI';
import { DeleteRowButton } from '@/lib/DeleteRowButton';

interface EditableDiscount {
  id?: string;
  code?: string;
  percent?: number;
  max_uses?: number | null;
  expires_at_text?: string;
  active?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function AdminDiscounts() {
  const [list, setList] = useState<DiscountCode[] | null>(null);
  const [editing, setEditing] = useState<EditableDiscount | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Hide first; keep `editing` so the modal keeps its content while it animates
  // closed (otherwise it flashes the empty "Add" state).
  function close() {
    setVisible(false);
  }

  async function load() {
    const { data, error } = await supabase
      .from('discount_codes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) Alert.alert('Error', error.message);
    setList((data as DiscountCode[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave() {
    if (!editing) return;
    const code = editing.code?.trim().toUpperCase();
    const percent = editing.percent ?? 0;
    const maxUsesRaw = editing.max_uses;
    const expiresText = editing.expires_at_text?.trim() ?? '';

    if (!code) {
      Alert.alert('Missing field', 'Code is required.');
      return;
    }
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      Alert.alert('Invalid percent', 'Percent must be between 1 and 100.');
      return;
    }
    if (maxUsesRaw != null && (!Number.isFinite(maxUsesRaw) || maxUsesRaw <= 0)) {
      Alert.alert('Invalid max uses', 'Leave blank for unlimited, or enter a positive number.');
      return;
    }
    let expiresAt: string | null = null;
    if (expiresText.length > 0) {
      if (!ISO_DATE.test(expiresText)) {
        Alert.alert('Invalid date', 'Use YYYY-MM-DD format, or leave blank for no expiry.');
        return;
      }
      expiresAt = new Date(expiresText + 'T23:59:59').toISOString();
    }

    setBusy(true);
    const payload: Record<string, unknown> = {
      code,
      percent,
      max_uses: maxUsesRaw ?? null,
      expires_at: expiresAt,
      active: editing.active ?? true
    };
    const { error } = editing.id
      ? await supabase.from('discount_codes').update(payload).eq('id', editing.id)
      : await supabase.from('discount_codes').insert(payload);
    setBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    close();
    load();
  }

  function openNew() {
    setEditing({
      code: '',
      percent: 10,
      max_uses: null,
      expires_at_text: '',
      active: true
    });
    setVisible(true);
  }

  function openEdit(dc: DiscountCode) {
    setEditing({
      id: dc.id,
      code: dc.code,
      percent: dc.percent,
      max_uses: dc.max_uses,
      expires_at_text: dc.expires_at ? dc.expires_at.slice(0, 10) : '',
      active: dc.active
    });
    setVisible(true);
  }

  if (!list) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <View style={s.flex}>
      <ScrollView contentContainerStyle={s.scrollContent}>
        <View style={s.headerRow}>
          <View style={pageHeader.wrap}>
            <Text style={pageHeader.subtitle}>Discounts · {list.length} codes</Text>
            <Text style={pageHeader.title}>Promo Codes</Text>
          </View>
          <Pressable style={({ pressed }) => [s.addBtnSm, pressed && s.addBtnPressed]} onPress={openNew}>
            <Ionicons name="add" size={18} color={colors.primaryText} />
            <Text style={s.addBtnText}>Add</Text>
          </Pressable>
        </View>

        {list.length === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Ionicons name="pricetag-outline" size={26} color={colors.subtle} />
            </View>
            <Text style={s.emptyTitle}>No discount codes yet</Text>
            <Text style={s.emptyText}>Create a promo code customers can apply at checkout.</Text>
            <Pressable style={({ pressed }) => [s.emptyBtn, pressed && s.addBtnPressed]} onPress={openNew}>
              <Ionicons name="add" size={18} color={colors.primaryText} />
              <Text style={s.addBtnText}>Add code</Text>
            </Pressable>
          </View>
        ) : (
          list.map((dc) => {
            const expired =
              dc.expires_at != null && new Date(dc.expires_at).getTime() < Date.now();
            const usedUp = dc.max_uses != null && dc.used_count >= dc.max_uses;
            const isActive = dc.active && !expired && !usedUp;
            const statusLabel = !dc.active
              ? 'Inactive'
              : expired
                ? 'Expired'
                : usedUp
                  ? 'Used up'
                  : 'Active';
            return (
              <Pressable
                key={dc.id}
                onPress={() => openEdit(dc)}
                style={({ pressed }) => [s.row, !isActive && s.rowInactive, pressed && s.rowPressed]}
              >
                <View style={s.iconChip}>
                  <Ionicons name="pricetag-outline" size={18} color={colors.accentDeep} />
                </View>
                <View style={s.rowMid}>
                  <View style={s.nameRow}>
                    <Text style={local.codePill}>{dc.code}</Text>
                    <View style={s.dotRow}>
                      <View style={isActive ? s.dotOk : s.dotDanger} />
                      <Text style={[s.sub, isActive ? s.subOk : s.subDanger]}>{statusLabel}</Text>
                    </View>
                  </View>
                  <Text style={s.metaSmall}>
                    {dc.used_count}/{dc.max_uses ?? '∞'} used
                    {dc.expires_at ? ` · expires ${dc.expires_at.slice(0, 10)}` : ' · no expiry'}
                  </Text>
                </View>
                <Text style={s.price}>−{dc.percent}%</Text>
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
            <Text style={s.modalTitle}>
              {editing?.id ? 'Edit code' : 'Add code'}
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
                <Ionicons name="pricetag-outline" size={18} color={colors.accentDeep} />
              </View>
              <View style={s.rowMid}>
                <View style={s.nameRow}>
                  <Text style={local.codePill}>{editing?.code?.trim() || 'CODE'}</Text>
                  <View style={s.dotRow}>
                    <View style={(editing?.active ?? true) ? s.dotOk : s.dotDanger} />
                    <Text style={[s.sub, (editing?.active ?? true) ? s.subOk : s.subDanger]}>
                      {(editing?.active ?? true) ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>
                <Text style={s.metaSmall}>
                  0/{editing?.max_uses ?? '∞'} used
                  {editing?.expires_at_text?.trim()
                    ? ` · expires ${editing.expires_at_text.trim()}`
                    : ' · no expiry'}
                </Text>
              </View>
              <Text style={s.price}>−{editing?.percent || 0}%</Text>
            </View>

            <View style={s.formCard}>
              <Text style={s.label}>Code</Text>
              <TextInput
                style={[s.input, { textTransform: 'uppercase', letterSpacing: 0.4 }]}
                value={editing?.code ?? ''}
                onChangeText={(v) =>
                  setEditing((e) => ({ ...e!, code: v.toUpperCase().replace(/\s/g, '') }))
                }
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="WELCOME10"
                placeholderTextColor={colors.subtle}
              />

              <Text style={s.label}>Percent off</Text>
              <View style={s.priceField}>
                <TextInput
                  style={s.priceInput}
                  value={String(editing?.percent ?? '')}
                  onChangeText={(v) =>
                    setEditing((e) => ({ ...e!, percent: parseInt(v, 10) || 0 }))
                  }
                  keyboardType="number-pad"
                  placeholder="10"
                  placeholderTextColor={colors.subtle}
                />
                <Text style={s.priceSuffix}>%</Text>
              </View>

              <Text style={s.label}>Max uses (blank = unlimited)</Text>
              <TextInput
                style={s.input}
                value={editing?.max_uses == null ? '' : String(editing.max_uses)}
                onChangeText={(v) =>
                  setEditing((e) => ({
                    ...e!,
                    max_uses: v.trim() === '' ? null : parseInt(v, 10) || 0
                  }))
                }
                keyboardType="number-pad"
                placeholder="100"
                placeholderTextColor={colors.subtle}
              />

              <Text style={s.label}>Expires (YYYY-MM-DD, blank = never)</Text>
              <TextInput
                style={s.input}
                value={editing?.expires_at_text ?? ''}
                onChangeText={(v) => setEditing((e) => ({ ...e!, expires_at_text: v }))}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="2026-12-31"
                placeholderTextColor={colors.subtle}
              />

              <View style={s.activeRowDivided}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Active</Text>
                  <Text style={s.helper}>Customers can't apply it when off.</Text>
                </View>
                <Switch
                  value={editing?.active ?? true}
                  onValueChange={(v) => setEditing((e) => ({ ...e!, active: v }))}
                  trackColor={{ false: colors.border, true: colors.text }}
                  thumbColor={colors.surface}
                />
              </View>
            </View>

            {editing?.id && (
              <DeleteRowButton
                label="discount code"
                name={editing.code?.trim() || 'this code'}
                onConfirm={async () => {
                  await deleteDiscount(editing.id!);
                }}
                onDeleted={() => {
                  close();
                  load();
                }}
                getImpact={async () => {
                  const n = await countDiscountBookings(editing.id!);
                  return n > 0
                    ? `Used in ${n} past booking${n === 1 ? '' : 's'}. The code is removed and unlinked from them — those sales are kept.`
                    : 'This code has never been used.';
                }}
              />
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const local = StyleSheet.create({
  codePill: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'monospace',
    letterSpacing: 0.4,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    overflow: 'hidden'
  }
});
