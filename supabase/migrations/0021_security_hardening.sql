-- Security hardening.
--
-- The customer website ships the (public) anon key, so anything anon can do is
-- effectively public. This migration narrows that:
--
--   1. Operator secret — destructive staff/control RPCs now require a shared
--      secret sent as the `x-operator-secret` request header. The secret lives
--      ONLY in the staff/admin app bundle (env), never in the customer site, so
--      a random visitor with the public key can't drive shop operations.
--   2. Cancel token — a customer can only cancel their OWN entry by presenting a
--      per-entry token (returned at join time, not readable via the API). Entry
--      ids alone are enumerable, so id != proof of ownership.
--   3. Server-side phone — customer_phone is no longer anon-readable. The staff
--      app fetches a single entry's phone through an operator-gated RPC.
--
-- SAFE ROLLOUT: the operator gate is a no-op until you set the secret (below),
-- so applying this migration won't break anything. Activate it by setting the
-- same strong secret in app_secret AND the app env (see the project notes).

-- ===== 1. Operator secret =====
create table if not exists public.app_secret (
  id smallint primary key default 1 check (id = 1),
  secret text,
  updated_at timestamptz not null default now()
);
insert into public.app_secret (id) values (1) on conflict (id) do nothing;

alter table public.app_secret enable row level security;
-- No select/insert/update policies → no client (anon or authenticated) can read
-- or write it. Only security-definer functions (run as owner) can read it.

-- Verify the caller presented the operator secret. No-op until a secret is set,
-- so the migration is safe to apply before the app env is configured.
create or replace function public.assert_operator()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_provided text;
begin
  select secret into v_expected from public.app_secret where id = 1;
  if v_expected is null or v_expected = '' then
    return; -- not configured yet → allow (set the secret to enforce)
  end if;

  begin
    v_provided := (current_setting('request.headers', true))::json ->> 'x-operator-secret';
  exception when others then
    v_provided := null;
  end;

  if v_provided is null or v_provided <> v_expected then
    raise exception 'Operator authorization required' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.assert_operator() to anon, authenticated;

-- ===== 2. Cancel ownership token =====
-- Returned to the customer by create_queue_entry (function result includes all
-- columns), but NOT in the anon column grant, so it can't be read back / guessed.
alter table public.queue_entries
  add column if not exists cancel_token uuid not null default gen_random_uuid();

-- Customer cancel now requires the token. (Old single-arg version removed.)
drop function if exists public.cancel_queue_entry(uuid);
create or replace function public.cancel_queue_entry(p_entry_id uuid, p_token uuid)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries;
begin
  update public.queue_entries
  set status = 'cancelled', completed_at = now()
  where id = p_entry_id and status = 'waiting' and cancel_token = p_token
  returning * into v_entry;

  if v_entry.id is null then
    raise exception 'Cannot cancel: entry is missing, already started, or not yours'
      using errcode = '22000';
  end if;

  return v_entry;
end;
$$;

grant execute on function public.cancel_queue_entry(uuid, uuid) to anon, authenticated;

-- ===== 3. Server-side phone lookup =====
revoke select (customer_phone) on public.queue_entries from anon;

-- discount_percent (added in 0019) is non-sensitive and the staff app shows it
-- as a hint when pricing a custom service — expose it to anon like the other
-- queue columns.
grant select (discount_percent) on public.queue_entries to anon;

create or replace function public.get_entry_phone(p_entry_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  perform public.assert_operator();
  select customer_phone into v_phone from public.queue_entries where id = p_entry_id;
  return v_phone;
end;
$$;

grant execute on function public.get_entry_phone(uuid) to anon, authenticated;

-- ===== 4. Gate destructive staff / control RPCs =====
-- Each is recreated identically to its latest version, with assert_operator() as
-- the first statement.

create or replace function public.start_shift(p_service_ids uuid[], p_staff_id uuid)
returns public.shifts
language plpgsql security definer set search_path = public
as $$
declare v_shift_id uuid; v_shift public.shifts;
begin
  perform public.assert_operator();
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;
  if not exists (select 1 from public.staff where id = p_staff_id and active) then
    raise exception 'Staff not found or inactive' using errcode = '22000';
  end if;
  if exists (select 1 from public.shifts where staff_id = p_staff_id and ended_at is null) then
    raise exception 'Already on an active shift' using errcode = '22000';
  end if;
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Pick at least one service' using errcode = '22000';
  end if;
  insert into public.shifts (staff_id) values (p_staff_id) returning id into v_shift_id;
  insert into public.shift_services (shift_id, service_id)
  select v_shift_id, sid from unnest(p_service_ids) as sid
  where exists (select 1 from public.services where id = sid and active);
  select * into v_shift from public.shifts where id = v_shift_id;
  return v_shift;
end;
$$;
grant execute on function public.start_shift(uuid[], uuid) to anon, authenticated;

create or replace function public.end_shift(p_staff_id uuid)
returns public.shifts
language plpgsql security definer set search_path = public
as $$
declare v_shift public.shifts;
begin
  perform public.assert_operator();
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;
  update public.breaks set ended_at = now(), started_at = coalesce(started_at, now())
  where staff_id = p_staff_id and ended_at is null;
  update public.shifts set ended_at = now()
  where staff_id = p_staff_id and ended_at is null
  returning * into v_shift;
  if v_shift.id is null then
    raise exception 'No active shift to end' using errcode = '22000';
  end if;
  return v_shift;
end;
$$;
grant execute on function public.end_shift(uuid) to anon, authenticated;

create or replace function public.complete_current_entry(p_staff_id uuid)
returns public.queue_entries
language plpgsql security definer set search_path = public
as $$
declare v_entry public.queue_entries;
begin
  perform public.assert_operator();
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;
  update public.queue_entries set status = 'done', completed_at = now()
  where staff_id = p_staff_id and queue_date = current_date and status = 'in_progress'
  returning * into v_entry;
  return v_entry;
end;
$$;
grant execute on function public.complete_current_entry(uuid) to anon, authenticated;

create or replace function public.start_next_entry(p_staff_id uuid)
returns public.queue_entries
language plpgsql security definer set search_path = public
as $$
declare v_entry public.queue_entries;
begin
  perform public.assert_operator();
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;
  if exists (
    select 1 from public.queue_entries
    where staff_id = p_staff_id and queue_date = current_date and status = 'in_progress'
  ) then
    raise exception 'Finish the current customer first' using errcode = '22000';
  end if;
  update public.queue_entries set status = 'in_progress', started_at = now()
  where id = (
    select id from public.queue_entries
    where staff_id = p_staff_id and queue_date = current_date and status = 'waiting'
    order by queue_number asc limit 1
  )
  returning * into v_entry;
  return v_entry;
end;
$$;
grant execute on function public.start_next_entry(uuid) to anon, authenticated;

create or replace function public.staff_adjust_entry_price(p_entry_id uuid, p_delta_sen integer)
returns public.queue_entries
language plpgsql security definer set search_path = public
as $$
declare
  v_entry public.queue_entries;
  v_percent integer := 0;
  v_new_adjustment integer;
  v_gross integer;
  v_final integer;
begin
  perform public.assert_operator();
  select * into v_entry from public.queue_entries
  where id = p_entry_id and status in ('waiting', 'in_progress') for update;
  if v_entry.id is null then
    raise exception 'Cannot adjust: entry is missing or already finished' using errcode = '22000';
  end if;
  if v_entry.base_price_sen is null then
    raise exception 'Set the price first' using errcode = '22000';
  end if;
  if v_entry.discount_code_id is not null then
    select coalesce(percent, 0) into v_percent from public.discount_codes where id = v_entry.discount_code_id;
    v_percent := coalesce(v_percent, 0);
  end if;
  v_new_adjustment := v_entry.price_adjustment_sen + p_delta_sen;
  v_gross := v_entry.base_price_sen + v_new_adjustment;
  if v_gross < 0 then
    raise exception 'Adjustment would make the price negative' using errcode = '22000';
  end if;
  v_final := v_gross - (v_gross * v_percent / 100);
  update public.queue_entries
  set price_adjustment_sen = v_new_adjustment, final_price_sen = v_final
  where id = p_entry_id returning * into v_entry;
  return v_entry;
end;
$$;
grant execute on function public.staff_adjust_entry_price(uuid, integer) to anon, authenticated;

create or replace function public.staff_set_custom_price(p_entry_id uuid, p_price_sen integer)
returns public.queue_entries
language plpgsql security definer set search_path = public
as $$
declare v_entry public.queue_entries; v_percent integer := 0; v_final integer;
begin
  perform public.assert_operator();
  if p_price_sen is null or p_price_sen < 0 then
    raise exception 'Price must be zero or more' using errcode = '22000';
  end if;
  select * into v_entry from public.queue_entries
  where id = p_entry_id and service_id is null and status in ('waiting', 'in_progress') for update;
  if v_entry.id is null then
    raise exception 'Cannot set price: entry is missing, not custom, or already finished'
      using errcode = '22000';
  end if;
  v_percent := coalesce(v_entry.discount_percent, 0);
  v_final := p_price_sen - (p_price_sen * v_percent / 100);
  update public.queue_entries
  set base_price_sen = p_price_sen, final_price_sen = v_final, price_adjustment_sen = 0
  where id = p_entry_id returning * into v_entry;
  return v_entry;
end;
$$;
grant execute on function public.staff_set_custom_price(uuid, integer) to anon, authenticated;

create or replace function public.staff_cancel_queue_entry(p_entry_id uuid)
returns public.queue_entries
language plpgsql security definer set search_path = public
as $$
declare v_entry public.queue_entries;
begin
  perform public.assert_operator();
  update public.queue_entries set status = 'cancelled', completed_at = now()
  where id = p_entry_id and status in ('waiting', 'in_progress')
  returning * into v_entry;
  if v_entry.id is null then
    raise exception 'Cannot cancel: entry is missing or already finished' using errcode = '22000';
  end if;
  return v_entry;
end;
$$;
grant execute on function public.staff_cancel_queue_entry(uuid) to anon, authenticated;

create or replace function public.start_break(p_staff_id uuid)
returns public.breaks
language plpgsql security definer set search_path = public
as $$
declare v_shift_id uuid; v_has_queue boolean; v_break public.breaks;
begin
  perform public.assert_operator();
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;
  select id into v_shift_id from public.shifts
  where staff_id = p_staff_id and ended_at is null order by started_at desc limit 1;
  if v_shift_id is null then
    raise exception 'Not on an active shift' using errcode = '22000';
  end if;
  if exists (select 1 from public.breaks where staff_id = p_staff_id and ended_at is null) then
    raise exception 'Already on a break' using errcode = '22000';
  end if;
  select exists (
    select 1 from public.queue_entries
    where staff_id = p_staff_id and queue_date = current_date and status in ('waiting', 'in_progress')
  ) into v_has_queue;
  insert into public.breaks (staff_id, shift_id, requested_at, started_at)
  values (p_staff_id, v_shift_id, now(), case when v_has_queue then null else now() end)
  returning * into v_break;
  return v_break;
end;
$$;
grant execute on function public.start_break(uuid) to anon, authenticated;

create or replace function public.end_break(p_staff_id uuid)
returns public.breaks
language plpgsql security definer set search_path = public
as $$
declare v_break public.breaks;
begin
  perform public.assert_operator();
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;
  update public.breaks set ended_at = now(), started_at = coalesce(started_at, now())
  where staff_id = p_staff_id and ended_at is null
  returning * into v_break;
  if v_break.id is null then
    raise exception 'No active break' using errcode = '22000';
  end if;
  return v_break;
end;
$$;
grant execute on function public.end_break(uuid) to anon, authenticated;

-- app_control normally lives only on the CONTROL project (migration 0017). On
-- the live project it may be absent, which would make the function below fail on
-- its return type. Create it if missing — harmless, and keeps schemas identical.
create table if not exists public.app_control (
  id smallint primary key default 1 check (id = 1),
  active_backend text not null default 'live'
    check (active_backend in ('mock', 'live')),
  updated_at timestamptz not null default now()
);
insert into public.app_control (id) values (1) on conflict (id) do nothing;
alter table public.app_control enable row level security;
drop policy if exists "anon reads app_control" on public.app_control;
create policy "anon reads app_control" on public.app_control for select to anon using (true);
drop policy if exists "authenticated reads app_control" on public.app_control;
create policy "authenticated reads app_control"
  on public.app_control for select to authenticated using (true);

create or replace function public.set_active_backend(p_value text)
returns public.app_control
language plpgsql security definer set search_path = public
as $$
declare v public.app_control;
begin
  perform public.assert_operator();
  if p_value is null or p_value not in ('mock', 'live') then
    raise exception 'Invalid backend: %', p_value using errcode = '22000';
  end if;
  update public.app_control set active_backend = p_value, updated_at = now()
  where id = 1 returning * into v;
  return v;
end;
$$;
grant execute on function public.set_active_backend(text) to anon, authenticated;
