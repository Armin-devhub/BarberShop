import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mock/Live backend toggle (read-only on web).
//
// The customer site reads the active_backend flag from the CONTROL project at
// startup and points `supabase` at MOCK or LIVE accordingly. It never flips the
// flag — only the admin app does that. Fails safe to LIVE if control is down.
// ---------------------------------------------------------------------------

export type Backend = 'mock' | 'live';

const CONTROL_URL = process.env.NEXT_PUBLIC_CONTROL_SUPABASE_URL;
const CONTROL_KEY = process.env.NEXT_PUBLIC_CONTROL_SUPABASE_ANON_KEY;
const LIVE_URL = process.env.NEXT_PUBLIC_LIVE_SUPABASE_URL;
const LIVE_KEY = process.env.NEXT_PUBLIC_LIVE_SUPABASE_ANON_KEY;
const MOCK_URL = process.env.NEXT_PUBLIC_MOCK_SUPABASE_URL ?? CONTROL_URL;
const MOCK_KEY = process.env.NEXT_PUBLIC_MOCK_SUPABASE_ANON_KEY ?? CONTROL_KEY;

if (!CONTROL_URL || !CONTROL_KEY || !LIVE_URL || !LIVE_KEY) {
  throw new Error(
    'Missing Supabase env vars. Copy web/.env.example to web/.env.local and fill in ' +
      'NEXT_PUBLIC_CONTROL_SUPABASE_URL/_ANON_KEY and NEXT_PUBLIC_LIVE_SUPABASE_URL/_ANON_KEY.'
  );
}

const OPTS = {
  auth: { persistSession: false }, // anonymous customer site, no login
  realtime: { params: { eventsPerSecond: 5 } }
} as const;

function makeClient(backend: Backend): SupabaseClient {
  return backend === 'mock'
    ? createClient(MOCK_URL as string, MOCK_KEY as string, OPTS)
    : createClient(LIVE_URL as string, LIVE_KEY as string, OPTS);
}

const controlClient = createClient(CONTROL_URL, CONTROL_KEY, OPTS);

let current: Backend = 'live'; // fail-safe default until the flag is read
let active: SupabaseClient = makeClient('live');

// Stable proxy so every `import { supabase }` always hits the current backend.
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

export async function initBackend(): Promise<Backend> {
  const flag = await readFlag();
  current = flag;
  active = makeClient(flag);
  return current;
}
