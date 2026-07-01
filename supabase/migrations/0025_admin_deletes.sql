-- Admin hard-delete RPCs for services and discount codes.
--
-- Why RPCs (not a plain client delete):
--   * services.id and discount_codes.id are referenced by queue_entries, and the
--     app (authenticated) role has NO delete grant on queue_entries — so it can't
--     clear those references itself. These SECURITY DEFINER functions run as the
--     owner and can.
--   * They are operator-gated (assert_operator) and admin-only, matching the other
--     destructive RPCs in 0021.
--
-- Products have no dependents at all, so the app deletes them directly via RLS.
-- Staff deletion lives in the delete-staff Edge Function (it must also remove the
-- auth user, which requires the service_role) — deleting the staff row cascades
-- their shifts, bookings, breaks and pay records automatically.

-- Force-delete a service: remove the bookings that used it (they can't be kept —
-- queue_entries.service_id is NOT NULL), then the service. shift_services rows
-- cascade on their own. Returns the number of bookings removed.
create or replace function public.admin_delete_service(p_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_bookings integer;
begin
  perform public.assert_operator();
  if public.current_staff_role() <> 'admin' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'Service id is required' using errcode = '22000';
  end if;

  delete from public.queue_entries where service_id = p_id;
  get diagnostics v_bookings = row_count;

  delete from public.services where id = p_id;
  return v_bookings;
end;
$$;
grant execute on function public.admin_delete_service(uuid) to anon, authenticated;

-- Delete a discount code: unlink it from past bookings first (those sales are
-- kept — the applied percent is stored separately on the entry as discount_percent),
-- then delete the code. Returns the number of bookings unlinked.
create or replace function public.admin_delete_discount(p_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_unlinked integer;
begin
  perform public.assert_operator();
  if public.current_staff_role() <> 'admin' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'Discount id is required' using errcode = '22000';
  end if;

  update public.queue_entries set discount_code_id = null where discount_code_id = p_id;
  get diagnostics v_unlinked = row_count;

  delete from public.discount_codes where id = p_id;
  return v_unlinked;
end;
$$;
grant execute on function public.admin_delete_discount(uuid) to anon, authenticated;
