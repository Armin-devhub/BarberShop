import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { brand, colors, radius, space } from '@/lib/theme';

// On web, Chrome/Safari force their own colors on autofilled inputs
// (-webkit-autofill). Inject a one-time override so prefilled fields keep the
// app's surface/ink look instead of the browser's yellow/blue.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const styleId = 'novyx-autofill-fix';
  if (!document.getElementById(styleId)) {
    const el = document.createElement('style');
    el.id = styleId;
    el.textContent = `
      input:-webkit-autofill,
      input:-webkit-autofill:hover,
      input:-webkit-autofill:focus,
      input:-webkit-autofill:active {
        -webkit-text-fill-color: ${colors.text} !important;
        -webkit-box-shadow: 0 0 0 1000px ${colors.surface} inset !important;
        box-shadow: 0 0 0 1000px ${colors.surface} inset !important;
        caret-color: ${colors.text} !important;
        transition: background-color 9999s ease-in-out 0s !important;
      }
    `;
    document.head.appendChild(el);
  }
}

export default function LoginScreen() {
  const router = useRouter();
  const { session, staff, loading } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');

  // Login exists only to reach admin, so go straight there after signing in.
  if (!loading && session && staff) return <Redirect href="/admin" />;

  async function handleSubmit() {
    setInfo('');
    if (!email.trim() || !password) {
      Alert.alert('Missing info', 'Email and password are required.');
      return;
    }
    setBusy(true);
    const { error } =
      mode === 'sign-in'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      Alert.alert(mode === 'sign-in' ? 'Sign-in failed' : 'Sign-up failed', error.message);
      return;
    }
    if (mode === 'sign-up') {
      setInfo('Account created. Signing you in…');
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });
      if (signInErr) {
        setInfo(
          'Account created, but auto sign-in failed. If you have email confirmation enabled, check your inbox first.'
        );
      }
    }
  }

  if (session && !staff && !loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.container, styles.card]}>
          <Text style={styles.kicker}>{brand.name}</Text>
          <Text style={styles.title}>Almost there</Text>
          <Text style={styles.subtitle}>
            Your account is created, but we couldn't find a staff record matching your email. Ask
            your admin to add you in the admin app, then sign out and back in.
          </Text>
          <Pressable
            style={styles.primary}
            onPress={async () => {
              await supabase.auth.signOut();
            }}
          >
            <Text style={styles.primaryText}>Sign out</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Image source={require('../assets/whitelogo.jpeg')} style={styles.logo} resizeMode="cover" />
          <Text style={styles.kicker}>{brand.name}</Text>
          <Text style={styles.title}>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</Text>
          <Text style={styles.subtitle}>Admins and staff only.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@novyx.my"
              placeholderTextColor={colors.subtle}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!busy}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.inputInner}
                placeholder="••••••••"
                placeholderTextColor={colors.subtle}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                editable={!busy}
              />
              <Pressable onPress={() => setShowPw((v) => !v)} hitSlop={8}>
                <Text style={styles.showLink}>{showPw ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            style={[styles.primary, busy && styles.disabled]}
            onPress={handleSubmit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Text style={styles.primaryText}>
                {mode === 'sign-in' ? 'Sign in' : 'Create account'}
              </Text>
            )}
          </Pressable>

          {info ? <Text style={styles.info}>{info}</Text> : null}

          <Pressable
            onPress={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setInfo('');
            }}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>
              {mode === 'sign-in' ? 'Create staff account' : 'Back to sign in'}
            </Text>
          </Pressable>

          <Pressable onPress={() => router.replace('/staff')}>
            <Text style={styles.backLink}>← Back to staff mode</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: space.xl, justifyContent: 'center', gap: space.sm },
  // Keep the form a comfortable reading width and centered on wide (web) screens.
  card: { width: '100%', maxWidth: 380, alignSelf: 'center', gap: space.sm },
  logo: { width: 52, height: 52, alignSelf: 'center', marginBottom: space.sm, borderRadius: 26 },
  kicker: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 0.3,
    marginBottom: 2
  },
  title: {
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
    color: colors.muted,
    marginBottom: space.lg
  },
  field: { gap: 6 },
  label: { fontSize: 11, fontWeight: '600', color: colors.muted, letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16
  },
  inputRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  inputInner: { flex: 1, fontSize: 16, color: colors.text },
  showLink: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.2 },
  primary: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: space.sm
  },
  primaryText: {
    color: colors.primaryText,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center'
  },
  secondaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2
  },
  disabled: { opacity: 0.5 },
  backLink: {
    textAlign: 'center',
    color: colors.muted,
    marginTop: space.lg,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2
  },
  info: {
    textAlign: 'center',
    color: colors.text,
    marginTop: space.sm,
    fontSize: 13
  }
});
