import { Redirect } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/**
 * Default landing: always send to staff mode (anonymous). Admin is only
 * reachable via the ADMIN button in the staff header — and the admin layout
 * gates itself behind /login.
 */
export default function Index() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
          gap: 12
        }}
      >
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600', letterSpacing: 0.3 }}>
          Novyx Barbershop
        </Text>
      </View>
    );
  }

  return <Redirect href="/staff" />;
}
