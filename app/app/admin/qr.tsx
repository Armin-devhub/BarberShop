import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cardShadow, colors, pageHeader, radius, space } from '@/lib/theme';

// Where the customer joins the queue. Editable + persisted on the device, so a
// future custom domain just needs a quick edit here — no rebuild.
const DEFAULT_CUSTOMER_URL = 'https://novyx-queue.vercel.app';
const STORAGE_KEY = 'novyx_customer_url';
const QR_SIZE = 240;

function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export default function AdminQr() {
  const [url, setUrl] = useState(DEFAULT_CUSTOMER_URL);
  const [draft, setDraft] = useState(DEFAULT_CUSTOMER_URL);
  const [loaded, setLoaded] = useState(false);
  const qrRef = useRef<{ toDataURL?: (cb: (data: string) => void) => void } | null>(null);

  // Load the saved URL once.
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          setUrl(saved);
          setDraft(saved);
        }
      } catch {
        // fall back to default
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const dirty = normalizeUrl(draft) !== url && draft.trim().length > 0;

  async function save() {
    const next = normalizeUrl(draft);
    if (!next) {
      Alert.alert('Empty link', 'Enter the customer site URL.');
      return;
    }
    setUrl(next);
    setDraft(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch {
      // QR still updates this session even if persistence fails.
    }
  }

  function resetToDefault() {
    setDraft(DEFAULT_CUSTOMER_URL);
    setUrl(DEFAULT_CUSTOMER_URL);
    AsyncStorage.setItem(STORAGE_KEY, DEFAULT_CUSTOMER_URL).catch(() => {});
  }

  function download() {
    const ref = qrRef.current;
    if (!ref?.toDataURL) {
      Alert.alert('Not ready', 'The QR code is still rendering — try again in a moment.');
      return;
    }
    ref.toDataURL((base64: string) => {
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = `data:image/png;base64,${base64}`;
        a.download = 'novyx-queue-qr.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        Alert.alert('Download', 'Open the admin app in a browser to download the PNG.');
      }
    });
  }

  function copyLink() {
    if (Platform.OS === 'web' && navigator?.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => Alert.alert('Copied', 'Customer link copied to clipboard.'),
        () => {}
      );
    } else {
      Alert.alert('Customer link', url);
    }
  }

  return (
    <ScrollView style={s.flex} contentContainerStyle={s.scrollContent}>
      <View style={pageHeader.wrap}>
        <Text style={pageHeader.subtitle}>QR Code</Text>
        <Text style={pageHeader.title}>Customer Queue</Text>
      </View>

      <Text style={s.lead}>
        Print this and put it at the counter. Customers scan it to open the queue
        page on their phone and join the line.
      </Text>

      {/* QR preview */}
      <View style={s.qrCard}>
        <View style={s.qrFrame}>
          {loaded && url.length > 0 && (
            <QRCode
              value={url}
              size={QR_SIZE}
              color={colors.text}
              backgroundColor="#FFFFFF"
              getRef={(c) => {
                qrRef.current = c as never;
              }}
            />
          )}
        </View>
        <Pressable onPress={copyLink} hitSlop={6} style={s.linkRow}>
          <Ionicons name="link-outline" size={14} color={colors.muted} />
          <Text style={s.linkText} numberOfLines={1}>
            {url.replace(/^https?:\/\//, '')}
          </Text>
          <Ionicons name="copy-outline" size={14} color={colors.subtle} />
        </Pressable>

        <View style={s.actionRow}>
          <Pressable
            onPress={download}
            style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]}
          >
            <Ionicons name="download-outline" size={18} color={colors.primaryText} />
            <Text style={s.primaryBtnText}>Download PNG</Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL(url)}
            style={({ pressed }) => [s.secondaryBtn, pressed && s.pressed]}
          >
            <Ionicons name="open-outline" size={18} color={colors.text} />
            <Text style={s.secondaryBtnText}>Open</Text>
          </Pressable>
        </View>
      </View>

      {/* Editable destination */}
      <View style={s.editCard}>
        <Text style={s.label}>Destination URL</Text>
        <Text style={s.helper}>
          The page the QR opens. Change this only if your customer site moves to a
          new address (e.g. a custom domain).
        </Text>
        <TextInput
          style={s.input}
          value={draft}
          onChangeText={setDraft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://novyx-queue.vercel.app"
          placeholderTextColor={colors.subtle}
        />
        <View style={s.editActions}>
          <Pressable onPress={resetToDefault} hitSlop={6} style={s.resetBtn}>
            <Text style={s.resetText}>Reset to default</Text>
          </Pressable>
          <Pressable
            onPress={save}
            disabled={!dirty}
            style={({ pressed }) => [
              s.saveBtn,
              !dirty && s.saveBtnDisabled,
              pressed && dirty && s.pressed
            ]}
          >
            <Text style={s.saveBtnText}>Save & regenerate</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space.lg, gap: space.sm },
  lead: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: space.xs },

  qrCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    alignItems: 'center',
    gap: space.md,
    ...cardShadow
  },
  qrFrame: {
    width: QR_SIZE + 32,
    height: QR_SIZE + 32,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center'
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  linkText: { fontSize: 13, fontWeight: '600', color: colors.text, flexShrink: 1 },

  actionRow: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: radius.md
  },
  primaryBtnText: { color: colors.primaryText, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface
  },
  secondaryBtnText: { color: colors.text, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  pressed: { opacity: 0.85 },

  editCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    ...cardShadow
  },
  label: { fontSize: 11, color: colors.muted, fontWeight: '600', letterSpacing: 0.4 },
  helper: { fontSize: 12, color: colors.subtle, lineHeight: 17 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
    marginTop: 2
  },
  editActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  resetBtn: { paddingVertical: 8 },
  resetText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  saveBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.md
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: colors.primaryText, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 }
});
