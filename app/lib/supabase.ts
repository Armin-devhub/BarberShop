import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mock/Live backend toggle.
//
// Three sets of creds:
//   CONTROL — the old project; permanently holds the active_backend flag.
//   MOCK    — demo backend (defaults to the control project).
//   LIVE    — the real shop (the new project).
//
// At startup we read the flag from CONTROL (anon, no login) and point `supabase`
// at MOCK or LIVE. If CONTROL is unreachable we fail safe to LIVE so the real
// shop never breaks. The flip is global: web and app both read the same flag.
// ---------------------------------------------------------------------------

export type Backend = 'mock' | 'live';

const CONTROL_URL = process.env.EXPO_PUBLIC_CONTROL_SUPABASE_URL;
const CONTROL_KEY = process.env.EXPO_PUBLIC_CONTROL_SUPABASE_ANON_KEY;
const LIVE_URL = process.env.EXPO_PUBLIC_LIVE_SUPABASE_URL;
const LIVE_KEY = process.env.EXPO_PUBLIC_LIVE_SUPABASE_ANON_KEY;
// Mock defaults to the control project when not separately configured.
const MOCK_URL = process.env.EXPO_PUBLIC_MOCK_SUPABASE_URL ?? CONTROL_URL;
const MOCK_KEY = process.env.EXPO_PUBLIC_MOCK_SUPABASE_ANON_KEY ?? CONTROL_KEY;

if (!CONTROL_URL || !CONTROL_KEY || !LIVE_URL || !LIVE_KEY) {
  throw new Error(
    'Missing Supabase env vars. Copy app/.env.example to app/.env.local and fill in ' +
      'EXPO_PUBLIC_CONTROL_SUPABASE_URL/_ANON_KEY and EXPO_PUBLIC_LIVE_SUPABASE_URL/_ANON_KEY.'
  );
}

// Operator secret — gates the destructive staff/control RPCs server-side. Lives
// ONLY in the staff/admin app bundle (never the customer site). Sent as a header
// on every request; the DB ignores it until the matching secret is configured.
const OPERATOR_SECRET = process.env.EXPO_PUBLIC_OPERATOR_SECRET;

// Admin login is intentionally NOT remembered (session in memory only).
const AUTH_OPTS = {
  auth: { autoRefreshToken: true, persistSession: false, detectSessionInUrl: false },
  ...(OPERATOR_SECRET
    ? { global: { headers: { 'x-operator-secret': OPERATOR_SECRET } } }
    : {})
} as const;

function makeClient(backend: Backend): SupabaseClient {
  return backend === 'mock'
    ? createClient(MOCK_URL as string, MOCK_KEY as string, AUTH_OPTS)
    : createClient(LIVE_URL as string, LIVE_KEY as string, AUTH_OPTS);
}

// The control client never changes — always the control project.
export const controlClient = createClient(CONTROL_URL, CONTROL_KEY, AUTH_OPTS);

let current: Backend = 'live'; // fail-safe default until the flag is read
let active: SupabaseClient = makeClient('live');

// Notify subscribers (e.g. AuthProvider) when the active client is swapped, so
// they can re-bind listeners to the new backend.
const backendListeners = new Set<() => void>();
export function onBackendChange(cb: () => void): () => void {
  backendListeners.add(cb);
  return () => {
    backendListeners.delete(cb);
  };
}

// Stable proxy so every `import { supabase }` always hits the current backend,
// even after a flip swaps the underlying client.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const value = (active as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(active) : value;
  }
});

export function getActiveBackend(): Backend {
  return current;
}

async function readFlag(): Promise<Backend> {
  // Fail safe to 'live' if control is slow or unreachable.
  const fallback = new Promise<Backend>((resolve) => setTimeout(() => resolve('live'), 2500));
  const read = (async (): Promise<Backend> => {
    const { data, error } = await controlClient
      .from('app_control')
      .select('active_backend')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return 'live';
    return data.active_backend === 'mock' ? 'mock' : 'live';
  })();
  return Promise.race([read, fallback]);
}

// Read the flag and point `supabase` at the chosen backend. Call once at startup
// (and again right after a flip to swap immediately).
export async function initBackend(): Promise<Backend> {
  const flag = await readFlag();
  current = flag;
  active = makeClient(flag);
  backendListeners.forEach((cb) => cb());
  return current;
}

// Flip the global flag (writes to the control project). Admin-only at the UI.
export async function setActiveBackend(next: Backend): Promise<void> {
  const { error } = await controlClient.rpc('set_active_backend', { p_value: next });
  if (error) throw error;
}

// Shop closing time (Malaysia time, "HH:MM") — drives the auto-end-shift cron.
// Read/written on the ACTIVE backend, since that's where the shifts + cron live.
export async function getShopCloseTime(): Promise<string> {
  const { data, error } = await supabase
    .from('app_control')
    .select('shop_close_time')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data?.shop_close_time) return '00:00';
  return String(data.shop_close_time).slice(0, 5); // 'HH:MM:SS' -> 'HH:MM'
}

export async function setShopCloseTime(value: string): Promise<void> {
  const { error } = await supabase.rpc('set_shop_close_time', { p_time: value });
  if (error) throw error;
}

export interface CleanDatabaseResult {
  deleted_customers: number;
  deleted_services: number;
  deleted_products: number;
  deleted_staff: number;
}

// Wipes the ACTIVE backend down to the calling admin's account. Irreversible.
// Requires the typed confirmation string the RPC checks ("ERASE").
export async function cleanDatabase(confirm: string): Promise<CleanDatabaseResult> {
  const { data, error } = await supabase.rpc('clean_database', { p_confirm: confirm });
  if (error) throw error;
  return data as CleanDatabaseResult;
}
