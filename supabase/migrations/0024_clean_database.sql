-- Admin "Clean database" — wipe everything except the calling admin's account and
-- the system-config tables the app needs to keep running.
--
-- KEPT:  the calling admin's staff row (whoever clicks the button), plus
--        app_control (backend flag + shop_close_time), app_secret (operator secret),
--        and shop_settings (pay rates). Without these the app would break.
-- WIPED: all other staff, all catalog (services, products, discount_codes), and all
--        operational data (queue_entries, shifts, shift_services, breaks, earnings,
--        salary_payments, salary_overrides).
--
-- Triple-guarded: operator secret + admin role + a typed confirmation string. This
-- is irreversible — there is no undo. Auth users are NOT touched, so the admin's
-- login still works afterward.

create or replace function public.clean_database(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_role text;
  c_queue int := 0;
  c_services int := 0;
  c_products int := 0;
  c_staff int := 0;
begin
  perform public.assert_operator();

  v_admin_id := public.current_staff_id();
  v_role := public.current_staff_role();

  -- Hard guard: never proceed without a known admin to keep, or we could wipe the
  -- last account (a null id would match every row in the staff delete below).
  if v_admin_id is null or v_role <> 'admin' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if p_confirm is distinct from 'ERASE' then
    raise exception 'Confirmation text does not match' using errcode = '22000';
  end if;

  -- FK-safe order: operational data first, then catalog, then other staff.
  -- queue_entries.service_id has no ON DELETE action (RESTRICT), so queue_entries
  -- MUST go before services.
  delete from public.earnings;
  delete from public.breaks;

  delete from public.queue_entries;
  get diagnostics c_queue = row_count;

  delete from public.shift_services;
  delete from public.shifts;
  delete from public.salary_payments;
  delete from public.salary_overrides;

  delete from public.products;
  get diagnostics c_products = row_count;

  delete from public.discount_codes;

  delete from public.services;
  get diagnostics c_services = row_count;

  delete from public.staff where id is distinct from v_admin_id;
  get diagnostics c_staff = row_count;

  return jsonb_build_object(
    'kept_admin', v_admin_id,
    'deleted_customers', c_queue,
    'deleted_services', c_services,
    'deleted_products', c_products,
    'deleted_staff', c_staff
  );
end;
$$;

grant execute on function public.clean_database(text) to anon, authenticated;
