import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env vars. Copy app/.env.example to app/.env.local and fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Admin login is intentionally NOT remembered. Login exists only to reach
    // the admin area, and the owner wants a fresh login every time. With
    // persistSession off, the session lives only in memory — it's gone on app
    // close (and on web page refresh), so admin must sign in again to return.
    autoRefreshToken: true,
    persistSession: false,
    detectSessionInUrl: false
  }
});
