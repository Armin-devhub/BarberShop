// Edge Function: permanently removes a staff member end-to-end.
//
// Caller must be an authenticated admin. Using the service_role key it (1) deletes
// the public.staff row — which cascades their shifts, bookings, breaks and pay
// records — and (2) deletes the linked Supabase auth user so their email is freed
// and they can no longer sign in.
//
// An admin cannot delete their own account (that would lock them out).
//
// Deployment:
//   supabase functions deploy delete-staff --project-ref <live-project-ref>
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by the Edge Functions runtime — no manual secrets required.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // x-operator-secret is sent on every request by the staff/admin app. The
  // browser's CORS preflight requires it to be listed here or the call is blocked.
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-operator-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface DeleteStaffPayload {
  id: string;
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

  // 2. Verify caller is an admin (service-role bypasses RLS).
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
  let payload: DeleteStaffPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const id = payload?.id;
  if (!id) {
    return jsonResponse({ error: 'Staff id is required' }, 400);
  }

  // 4. Look up the target staff row.
  const { data: target, error: targetErr } = await admin
    .from('staff')
    .select('id, auth_user_id, name')
    .eq('id', id)
    .maybeSingle();
  if (targetErr) {
    return jsonResponse({ error: targetErr.message }, 400);
  }
  if (!target) {
    return jsonResponse({ error: 'Staff member not found' }, 404);
  }

  // 5. Guard: don't let an admin delete their own account.
  if (target.auth_user_id && target.auth_user_id === user.id) {
    return jsonResponse(
      { error: "You can't delete your own account. Ask another admin." },
      400
    );
  }

  // 6. Delete the staff row (cascades shifts, bookings, breaks, pay records).
  const { error: delErr } = await admin.from('staff').delete().eq('id', id);
  if (delErr) {
    return jsonResponse({ error: delErr.message }, 400);
  }

  // 7. Delete the linked auth user so the email is freed. The staff row is
  //    already gone, so a failure here is a partial success, not a hard error.
  if (target.auth_user_id) {
    const { error: authDelErr } = await admin.auth.admin.deleteUser(target.auth_user_id);
    if (authDelErr) {
      return jsonResponse({
        ok: true,
        warning: `Staff removed, but their login could not be deleted: ${authDelErr.message}`
      });
    }
  }

  return jsonResponse({ ok: true });
});
