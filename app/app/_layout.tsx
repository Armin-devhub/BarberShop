import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '@/lib/auth';
import { initBackend } from '@/lib/supabase';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  // Resolve which backend (mock/live) to use before mounting anything that
  // queries Supabase. Fails safe to live inside initBackend().
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    initBackend().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {ready ? (
          <AuthProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg }
              }}
            />
          </AuthProvider>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
            <ActivityIndicator color={colors.text} />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
