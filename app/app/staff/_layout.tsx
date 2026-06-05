import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';

// Staff mode is anonymous — no auth check. Anyone with the tablet can use it.
export default function StaffLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg }
      }}
    />
  );
}
