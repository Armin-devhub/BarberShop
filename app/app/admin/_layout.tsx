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
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { brand, colors, radius, space } from '@/lib/theme';

type IonName = keyof typeof Ionicons.glyphMap;
type NavItem = { label: string; path: string; icon: IonName };

const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'OVERVIEW',
    items: [{ label: 'Dashboard', path: '/admin', icon: 'grid-outline' }]
  },
  {
    heading: 'CATALOG',
    items: [
      { label: 'Services', path: '/admin/services', icon: 'cut-outline' },
      { label: 'Products', path: '/admin/products', icon: 'cube-outline' },
      { label: 'Discounts', path: '/admin/discounts', icon: 'pricetag-outline' }
    ]
  },
  {
    heading: 'PEOPLE',
    items: [
      { label: 'Staff', path: '/admin/staff', icon: 'people-outline' },
      { label: 'Attendance', path: '/admin/attendance', icon: 'calendar-outline' },
      { label: 'Pay', path: '/admin/pay', icon: 'cash-outline' }
    ]
  },
  {
    heading: 'SYSTEM',
    items: [
      { label: 'Reports', path: '/admin/reports', icon: 'bar-chart-outline' },
      { label: 'Settings', path: '/admin/settings', icon: 'settings-outline' }
    ]
  }
];

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
            {NAV_GROUPS.map((group) => (
              <View key={group.heading} style={s.navGroup}>
                <Text style={s.navHeading}>{group.heading}</Text>
                {group.items.map((item) => {
                  // '/admin' is the dashboard index — match it exactly so it
                  // isn't highlighted for every nested admin route.
                  const active =
                    item.path === '/admin'
                      ? pathname === '/admin'
                      : pathname?.startsWith(item.path);
                  return (
                    <Pressable
                      key={item.path}
                      onPress={() => router.push(item.path)}
                      style={({ pressed }) => [
                        s.navItem,
                        active && s.navItemActive,
                        pressed && !active && s.navItemPressed
                      ]}
                    >
                      <Ionicons
                        name={item.icon}
                        size={18}
                        color={active ? colors.accent : colors.muted}
                        style={s.navIcon}
                      />
                      <Text style={[s.navText, active && s.navTextActive]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <View style={s.account}>
            <View style={s.accountAvatar}>
              <Text style={s.accountAvatarText}>
                {staff.name.trim().charAt(0).toUpperCase() || 'A'}
              </Text>
            </View>
            <View style={s.accountIdent}>
              <Text style={s.accountName} numberOfLines={1}>
                {staff.name}
              </Text>
              <Text style={s.accountRole}>Admin</Text>
            </View>
            <Pressable
              onPress={signOut}
              hitSlop={8}
              style={({ pressed }) => [s.signOutBtn, pressed && s.signOutPressed]}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>
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

  navGroup: { marginBottom: space.md },
  navHeading: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.subtle,
    letterSpacing: 1.2,
    paddingHorizontal: space.md,
    marginLeft: space.sm,
    marginBottom: 4
  },

  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    marginHorizontal: space.sm,
    marginBottom: 2,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent'
  },
  navItemActive: {
    backgroundColor: colors.accentSoft,
    borderLeftColor: colors.accent
  },
  navItemPressed: { backgroundColor: colors.surfaceAlt },
  navIcon: { width: 18, textAlign: 'center' },
  navText: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  navTextActive: { color: colors.text, fontWeight: '600' },

  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  accountAvatar: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center'
  },
  accountAvatarText: { fontSize: 14, fontWeight: '700', color: colors.accentDeep },
  accountIdent: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 13, fontWeight: '700', color: colors.text, letterSpacing: -0.1 },
  accountRole: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.muted,
    letterSpacing: 1,
    marginTop: 1
  },
  signOutBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center'
  },
  signOutPressed: { backgroundColor: colors.dangerSoft },

  main: { flex: 1, backgroundColor: colors.bg }
});
