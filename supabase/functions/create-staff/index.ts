// Edge Function: provisions a new staff member end-to-end.
//
// Caller must be an authenticated admin. The function uses the project's
// service_role key to (1) create a Supabase auth user with the supplied
// email/password (auto-confirmed) and (2) insert a matching row into
// public.staff linked to that user. If the staff insert fails, the auth
// user is rolled back.
//
// Deployment:
//   supabase functions deploy create-staff
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// the Edge Functions runtime — no manual secrets required.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // x-operator-secret is sent on every request by the staff/admin app (it gates
  // the destructive RPCs). The browser's CORS preflight requires it to be listed
  // here, or the call is blocked before it reaches the function.
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-operator-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type StaffRole = 'barber' | 'admin';
type EmploymentType = 'full_time' | 'commission';

interface CreateStaffPayload {
  name: string;
  phone: string;
  email: string;
  password: string;
  role: StaffRole;
  employment_type?: EmploymentType;
  active?: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'Server is not configured' }, 500);
  }

  // 1. Verify caller is authenticated.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const {
    data: { user },
    error: userErr
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  // 2. Verify caller is an admin (using service-role to bypass RLS).
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: callerStaff } = await admin
    .from('staff')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!callerStaff || callerStaff.role !== 'admin') {
    return jsonResponse({ error: 'Admin role required' }, 403);
  }

  // 3. Validate payload.
  let payload: CreateStaffPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const { name, phone, email, password, role } = payload ?? {};
  if (!name || !phone || !email || !password || !role) {
    return jsonResponse(
      { error: 'name, phone, email, password, and role are required' },
      400
    );
  }
  if (role !== 'barber' && role !== 'admin') {
    return jsonResponse({ error: 'role must be "barber" or "admin"' }, 400);
  }
  if (password.length < 6) {
    return jsonResponse({ error: 'password must be at least 6 characters' }, 400);
  }

  const normEmail = email.trim().toLowerCase();

  // 4. Create the auth user (auto-confirmed so they can sign in immediately).
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: normEmail,
    password,
    email_confirm: true
  });
  if (authErr || !authData?.user) {
    return jsonResponse(
      { error: authErr?.message ?? 'Failed to create auth user' },
      400
    );
  }

  // 5. Insert the staff row linked to the new auth user.
  const employmentType: EmploymentType =
    payload.employment_type === 'full_time' ? 'full_time' : 'commission';
  const { data: staff, error: staffErr } = await admin
    .from('staff')
    .insert({
      auth_user_id: authData.user.id,
      name: name.trim(),
      phone: phone.trim(),
      email: normEmail,
      role,
      employment_type: employmentType,
      active: payload.active ?? true
    })
    .select()
    .single();

  if (staffErr) {
    // Rollback the auth user so we don't leave an orphan.
    await admin.auth.admin.deleteUser(authData.user.id);
    return jsonResponse({ error: staffErr.message }, 400);
  }

  return jsonResponse({ staff }, 200);
});
