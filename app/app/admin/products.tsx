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
  const [busy, setBusy] = useState(false);

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
    setEditing(null);
    load();
  }

  function openNew() {
    setEditing({ name: '', priceText: '', active: true });
  }

  function openEdit(p: Product) {
    setEditing({
      id: p.id,
      name: p.name,
      priceText: (p.price_sen / 100).toFixed(2),
      active: p.active
    });
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
        <View style={pageHeader.wrap}>
          <Text style={pageHeader.subtitle}>Products · {list.length} in store</Text>
          <Text style={pageHeader.title}>Pomade & care</Text>
        </View>

        <Pressable style={s.addBtn} onPress={openNew}>
          <Text style={s.addBtnText}>+ Add product</Text>
        </Pressable>

        {list.length === 0 && (
          <Text style={s.muted}>No products yet. Tap "Add product" to add one.</Text>
        )}

        {list.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => openEdit(p)}
            style={p.active ? s.row : s.rowDisabled}
          >
            <View style={{ flex: 1 }}>
              <View style={s.nameRow}>
                <Text style={p.active ? s.name : s.nameDim}>{p.name}</Text>
                <View style={s.dotRow}>
                  <View style={p.active ? s.dotOk : s.dotDanger} />
                  <Text style={p.active ? s.statusOk : s.statusDanger}>
                    {p.active ? 'In stock' : 'Out of stock'}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={p.active ? s.price : s.priceDim}>{formatRM(p.price_sen)}</Text>
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
              {editing?.id ? 'Edit product' : 'Add product'}
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
              placeholder="Pomade"
              placeholderTextColor={colors.subtle}
            />

            <Text style={s.label}>Price (RM)</Text>
            <TextInput
              style={s.input}
              value={editing?.priceText ?? ''}
              onChangeText={(v) => setEditing((e) => ({ ...e!, priceText: v }))}
              keyboardType="decimal-pad"
              placeholder="35.00"
              placeholderTextColor={colors.subtle}
            />

            <View style={s.activeRow}>
              <Text style={s.label}>Active (in stock)</Text>
              <Switch
                value={editing?.active ?? true}
                onValueChange={(v) => setEditing((e) => ({ ...e!, active: v }))}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={'#fff'}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
