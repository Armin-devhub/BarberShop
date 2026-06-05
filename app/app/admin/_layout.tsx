import { useEffect, useRef } from 'react';
import { Slot, Redirect, useRouter, usePathname } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { brand, colors, radius, space } from '@/lib/theme';

const NAV = [
  { label: 'Dashboard', path: '/admin' },
  { label: 'Staff', path: '/admin/staff' },
  { label: 'Services', path: '/admin/services' },
  { label: 'Products', path: '/admin/products' },
  { label: 'Discounts', path: '/admin/discounts' },
  { label: 'Pay', path: '/admin/pay' },
  { label: 'Reports', path: '/admin/reports' },
  { label: 'Settings', path: '/admin/settings' }
] as const;

export default function AdminLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { session, staff, signOut, loading } = useAuth();

  // Sign out whenever the admin area is left (navigate away, back gesture,
  // unmount). Combined with persistSession:false, this means admin must log in
  // every single time they open the admin page — never a remembered session.
  // Kept in a ref so the unmount cleanup doesn't re-run on every render.
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  useEffect(() => {
    return () => {
      signOutRef.current();
    };
  }, []);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  if (!session || !staff) return <Redirect href="/login" />;
  if (staff.role !== 'admin') return <Redirect href="/staff" />;

  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right', 'bottom']}>
      <View style={s.row}>
        <View style={s.sidebar}>
          <View style={s.brandWrap}>
            <Image source={require('../../assets/whitelogo.jpeg')} style={s.logo} resizeMode="cover" />
            <Text style={s.brand}>{brand.short}</Text>
            <Text style={s.brandSub}>ADMIN</Text>
            <View style={s.brandRule} />
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: space.sm }}>
            {NAV.map((item) => {
              // '/admin' is the dashboard index — match it exactly so it isn't
              // highlighted for every nested admin route.
              const active =
                item.path === '/admin'
                  ? pathname === '/admin'
                  : pathname?.startsWith(item.path);
              return (
                <Pressable
                  key={item.path}
                  onPress={() => router.push(item.path)}
                  style={[s.navItem, active && s.navItemActive]}
                >
                  <Text style={[s.navText, active && s.navTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable onPress={signOut} style={s.signOut}>
            <Text style={s.signOutText}>SIGN OUT</Text>
          </Pressable>
        </View>

        <View style={s.main}>
          <Slot />
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  row: { flex: 1, flexDirection: 'row' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  sidebar: {
    width: 168,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: space.md
  },
  brandWrap: { paddingHorizontal: space.md, marginBottom: space.md },
  logo: { width: 34, height: 34, marginBottom: 8, borderRadius: 17 },
  brand: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4
  },
  brandSub: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 1.5,
    marginTop: 2
  },
  brandRule: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: space.md
  },

  navItem: {
    paddingVertical: 10,
    paddingHorizontal: space.md,
    marginHorizontal: space.sm,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent'
  },
  navItemActive: {
    backgroundColor: colors.okSoft,
    borderLeftColor: colors.ok
  },
  navText: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  navTextActive: { color: colors.text, fontWeight: '600' },

  signOut: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  signOutText: {
    fontSize: 13,
    color: colors.danger,
    fontWeight: '600',
    letterSpacing: 0.2
  },

  main: { flex: 1, backgroundColor: colors.bg }
});
