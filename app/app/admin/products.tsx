import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { formatRM, type Product } from '@/lib/types';
import { colors, pageHeader } from '@/lib/theme';
import { adminUI as s } from '@/lib/adminUI';

interface EditableProduct {
  id?: string;
  name?: string;
  priceText?: string;
  active?: boolean;
}

export default function AdminProducts() {
  const [list, setList] = useState<Product[] | null>(null);
  const [editing, setEditing] = useState<EditableProduct | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Hide first; keep `editing` so the modal keeps its content while it animates
  // closed (otherwise it flashes the empty "Add" state).
  function close() {
    setVisible(false);
  }

  async function load() {
    const { data, error } = await supabase.from('products').select('*').order('price_sen');
    if (error) Alert.alert('Error', error.message);
    setList((data as Product[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave() {
    if (!editing) return;
    const name = editing.name?.trim();
    const priceFloat = parseFloat((editing.priceText ?? '').replace(',', '.'));

    if (!name) {
      Alert.alert('Missing field', 'Name is required.');
      return;
    }
    if (!Number.isFinite(priceFloat) || priceFloat < 0) {
      Alert.alert('Invalid price', 'Enter a price like 25 or 25.50.');
      return;
    }

    setBusy(true);
    const payload = {
      name,
      price_sen: Math.round(priceFloat * 100),
      active: editing.active ?? true
    };
    const { error } = editing.id
      ? await supabase.from('products').update(payload).eq('id', editing.id)
      : await supabase.from('products').insert(payload);
    setBusy(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    close();
    load();
  }

  function openNew() {
    setEditing({ name: '', priceText: '', active: true });
    setVisible(true);
  }

  function openEdit(p: Product) {
    setEditing({
      id: p.id,
      name: p.name,
      priceText: (p.price_sen / 100).toFixed(2),
      active: p.active
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
            <Text style={pageHeader.subtitle}>Products · {list.length} in store</Text>
            <Text style={pageHeader.title}>Pomade & care</Text>
          </View>
          <Pressable style={({ pressed }) => [s.addBtnSm, pressed && s.addBtnPressed]} onPress={openNew}>
            <Ionicons name="add" size={18} color={colors.primaryText} />
            <Text style={s.addBtnText}>Add</Text>
          </Pressable>
        </View>

        {list.length === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Ionicons name="cube-outline" size={26} color={colors.subtle} />
            </View>
            <Text style={s.emptyTitle}>No products yet</Text>
            <Text style={s.emptyText}>Add pomade, wax, or care products you sell at the counter.</Text>
            <Pressable style={({ pressed }) => [s.emptyBtn, pressed && s.addBtnPressed]} onPress={openNew}>
              <Ionicons name="add" size={18} color={colors.primaryText} />
              <Text style={s.addBtnText}>Add product</Text>
            </Pressable>
          </View>
        ) : (
          list.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => openEdit(p)}
              style={({ pressed }) => [s.row, !p.active && s.rowInactive, pressed && s.rowPressed]}
            >
              <View style={s.iconChip}>
                <Ionicons name="cube-outline" size={18} color={colors.accentDeep} />
              </View>
              <View style={s.rowMid}>
                <Text style={s.name} numberOfLines={1}>
                  {p.name}
                </Text>
                <View style={s.subRow}>
                  <View style={p.active ? s.dotOk : s.dotDanger} />
                  <Text style={[s.sub, p.active ? s.subOk : s.subDanger]}>
                    {p.active ? 'In stock' : 'Out of stock'}
                  </Text>
                </View>
              </View>
              <Text style={s.price}>{formatRM(p.price_sen)}</Text>
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
              {editing?.id ? 'Edit product' : 'Add product'}
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
                <Ionicons name="cube-outline" size={18} color={colors.accentDeep} />
              </View>
              <View style={s.rowMid}>
                <Text style={s.name} numberOfLines={1}>
                  {editing?.name?.trim() || 'New product'}
                </Text>
                <View style={s.subRow}>
                  <View style={(editing?.active ?? true) ? s.dotOk : s.dotDanger} />
                  <Text style={[s.sub, (editing?.active ?? true) ? s.subOk : s.subDanger]}>
                    {(editing?.active ?? true) ? 'In stock' : 'Out of stock'}
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
                placeholder="Pomade"
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
                  placeholder="35.00"
                  placeholderTextColor={colors.subtle}
                />
              </View>

              <View style={s.activeRowDivided}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>In stock</Text>
                  <Text style={s.helper}>Hidden from the counter when off.</Text>
                </View>
                <Switch
                  value={editing?.active ?? true}
                  onValueChange={(v) => setEditing((e) => ({ ...e!, active: v }))}
                  trackColor={{ false: colors.border, true: colors.text }}
                  thumbColor={'#fff'}
                />
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
