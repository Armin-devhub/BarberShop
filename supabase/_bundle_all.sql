-- ============================================================
-- Novyx Barbershop — full schema bundle (migrations 0001-0017)
-- For applying to a fresh LIVE Supabase project in one paste.
-- NO seed data (real shop starts empty). Run in: SQL Editor -> New query.
-- For a demo/mock DB, run supabase/seed.sql afterwards.
-- ============================================================


-- ============================================================
-- migrations/0001_schema.sql
-- ============================================================

-- Barbershop queue system: schema + indexes + views.

create extension if not exists "pgcrypto";

-- staff: barbers and admins. Linked 1:1 to a Supabase auth user.
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  phone text not null,
  role text not null check (role in ('barber', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- services: shop-wide catalog. price_sen is RM cents (integer).
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_sen integer not null check (price_sen >= 0),
  duration_minutes integer not null default 30 check (duration_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- shifts: clock in / clock out events. ended_at IS NULL means currently on shift.
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);

-- A barber can only have one open shift at a time.
create unique index if not exists shifts_one_open_per_staff
  on public.shifts (staff_id) where ended_at is null;

-- shift_services: which services a barber offers DURING a specific shift.
-- (Lets a barber offer different services on different days.)
create table if not exists public.shift_services (
  shift_id uuid not null references public.shifts(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (shift_id, service_id)
);

-- discount_codes: percentage-only. NULL max_uses = unlimited, NULL expires_at = never.
create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  percent integer not null check (percent > 0 and percent <= 100),
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.staff(id) on delete set null
);

create index if not exists discount_codes_code_upper_idx
  on public.discount_codes (upper(code));

-- queue_entries: one row per customer joining a queue.
-- queue_number resets per (staff_id, queue_date) so each barber starts at #1 each day.
create table if not exists public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  service_id uuid not null references public.services(id),
  discount_code_id uuid references public.discount_codes(id),
  queue_number integer not null,
  queue_date date not null default current_date,
  status text not null default 'waiting'
    check (status in ('waiting', 'in_progress', 'done', 'cancelled')),
  base_price_sen integer not null,
  final_price_sen integer not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (staff_id, queue_date, queue_number)
);

create index if not exists queue_entries_staff_date_status_idx
  on public.queue_entries (staff_id, queue_date, status);

-- View: barbers currently on shift, with how many customers are waiting/in-progress.
-- Used by the customer "pick a barber" page.
create or replace view public.barbers_on_shift as
select
  s.id            as shift_id,
  s.started_at,
  st.id           as staff_id,
  st.name         as staff_name,
  (
    select count(*) from public.queue_entries qe
    where qe.staff_id = st.id
      and qe.queue_date = current_date
      and qe.status in ('waiting', 'in_progress')
  ) as waiting_count
from public.shifts s
join public.staff st on st.id = s.staff_id
where s.ended_at is null and st.active and st.role = 'barber';

-- View: which services each on-shift barber offers today.
-- Used by the customer "pick a service" page.
create or replace view public.barber_shift_services as
select
  s.id            as shift_id,
  st.id           as staff_id,
  st.name         as staff_name,
  sv.id           as service_id,
  sv.name         as service_name,
  sv.price_sen,
  sv.duration_minutes
from public.shifts s
join public.staff st           on st.id = s.staff_id
join public.shift_services ss  on ss.shift_id = s.id
join public.services sv        on sv.id = ss.service_id
where s.ended_at is null and sv.active and st.active;

-- Realtime: customer queue page subscribes to live updates on their entry.
alter publication supabase_realtime add table public.queue_entries;
alter publication supabase_realtime add table public.shifts;


-- ============================================================
-- migrations/0002_functions.sql
-- ============================================================

-- RPC functions. All `security definer` so they can bypass RLS for trusted operations.

-- Atomically: validate inputs, redeem discount, assign queue number, insert entry.
-- Called by anonymous customers from the website.
create or replace function public.create_queue_entry(
  p_staff_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_service_id uuid,
  p_discount_code text default null
) returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id uuid;
  v_service_price integer;
  v_discount_id uuid;
  v_discount_percent integer;
  v_base_price integer;
  v_final_price integer;
  v_queue_number integer;
  v_entry public.queue_entries;
begin
  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'Customer name is required' using errcode = '22000';
  end if;
  if length(trim(coalesce(p_customer_phone, ''))) = 0 then
    raise exception 'Customer phone is required' using errcode = '22000';
  end if;

  -- Verify barber is currently on shift.
  select id into v_shift_id
  from public.shifts
  where staff_id = p_staff_id and ended_at is null
  order by started_at desc
  limit 1;

  if v_shift_id is null then
    raise exception 'Barber is not currently on shift' using errcode = '22000';
  end if;

  -- Verify barber offers this service today.
  if not exists (
    select 1 from public.shift_services
    where shift_id = v_shift_id and service_id = p_service_id
  ) then
    raise exception 'This barber does not offer that service today' using errcode = '22000';
  end if;

  select price_sen into v_service_price
  from public.services
  where id = p_service_id and active;

  if v_service_price is null then
    raise exception 'Service not found or inactive' using errcode = '22000';
  end if;

  v_base_price := v_service_price;
  v_final_price := v_service_price;

  -- Optional discount.
  if p_discount_code is not null and length(trim(p_discount_code)) > 0 then
    select id, percent into v_discount_id, v_discount_percent
    from public.discount_codes
    where upper(code) = upper(trim(p_discount_code))
      and active
      and (expires_at is null or expires_at > now())
      and (max_uses is null or used_count < max_uses)
    for update;

    if v_discount_id is null then
      raise exception 'Invalid or expired discount code' using errcode = '22000';
    end if;

    update public.discount_codes
    set used_count = used_count + 1
    where id = v_discount_id;

    v_final_price := v_service_price - (v_service_price * v_discount_percent / 100);
  end if;

  -- Serialize queue-number assignment per (barber, date).
  perform pg_advisory_xact_lock(
    hashtext(p_staff_id::text || current_date::text)
  );

  select coalesce(max(queue_number), 0) + 1 into v_queue_number
  from public.queue_entries
  where staff_id = p_staff_id and queue_date = current_date;

  insert into public.queue_entries (
    staff_id, shift_id, customer_name, customer_phone,
    service_id, discount_code_id,
    queue_number, queue_date,
    base_price_sen, final_price_sen
  ) values (
    p_staff_id, v_shift_id, trim(p_customer_name), trim(p_customer_phone),
    p_service_id, v_discount_id,
    v_queue_number, current_date,
    v_base_price, v_final_price
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function public.create_queue_entry(uuid, text, text, uuid, text)
  to anon, authenticated;

-- Advance the queue: mark current in_progress as done, promote next waiting.
-- Returns the newly-promoted entry, or NULL if none waiting.
create or replace function public.advance_queue(p_staff_id uuid)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_caller_role text;
  v_entry public.queue_entries;
begin
  select id, role into v_caller_id, v_caller_role
  from public.staff
  where auth_user_id = auth.uid();

  if v_caller_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_caller_role <> 'admin' and v_caller_id <> p_staff_id then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.queue_entries
  set status = 'done', completed_at = now()
  where staff_id = p_staff_id
    and queue_date = current_date
    and status = 'in_progress';

  update public.queue_entries
  set status = 'in_progress', started_at = now()
  where id = (
    select id from public.queue_entries
    where staff_id = p_staff_id
      and queue_date = current_date
      and status = 'waiting'
    order by queue_number asc
    limit 1
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function public.advance_queue(uuid) to authenticated;

-- Clock in: create a shift and pick which services you'll offer today.
create or replace function public.start_shift(p_service_ids uuid[])
returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_shift_id uuid;
  v_shift public.shifts;
begin
  select id into v_staff_id from public.staff
  where auth_user_id = auth.uid() and active;
  if v_staff_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if exists (select 1 from public.shifts where staff_id = v_staff_id and ended_at is null) then
    raise exception 'Already on an active shift' using errcode = '22000';
  end if;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Pick at least one service' using errcode = '22000';
  end if;

  insert into public.shifts (staff_id) values (v_staff_id)
  returning id into v_shift_id;

  insert into public.shift_services (shift_id, service_id)
  select v_shift_id, sid
  from unnest(p_service_ids) as sid
  where exists (select 1 from public.services where id = sid and active);

  select * into v_shift from public.shifts where id = v_shift_id;
  return v_shift;
end;
$$;

grant execute on function public.start_shift(uuid[]) to authenticated;

-- Clock out: end the caller's open shift.
create or replace function public.end_shift()
returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_shift public.shifts;
begin
  select id into v_staff_id from public.staff where auth_user_id = auth.uid();
  if v_staff_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.shifts set ended_at = now()
  where staff_id = v_staff_id and ended_at is null
  returning * into v_shift;

  if v_shift.id is null then
    raise exception 'No active shift to end' using errcode = '22000';
  end if;

  return v_shift;
end;
$$;

grant execute on function public.end_shift() to authenticated;

-- Validate a discount code WITHOUT redeeming it. Used on the customer page to
-- preview the discounted price before they confirm.
create or replace function public.preview_discount(
  p_code text,
  p_service_id uuid
) returns table (
  valid boolean,
  percent integer,
  base_price_sen integer,
  final_price_sen integer,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_price integer;
  v_percent integer;
begin
  select price_sen into v_service_price
  from public.services where id = p_service_id and active;

  if v_service_price is null then
    return query select false, null::integer, null::integer, null::integer, 'Service not found';
    return;
  end if;

  select dc.percent into v_percent
  from public.discount_codes dc
  where upper(dc.code) = upper(trim(p_code))
    and dc.active
    and (dc.expires_at is null or dc.expires_at > now())
    and (dc.max_uses is null or dc.used_count < dc.max_uses);

  if v_percent is null then
    return query select false, null::integer, v_service_price, v_service_price, 'Invalid or expired code';
    return;
  end if;

  return query select
    true,
    v_percent,
    v_service_price,
    v_service_price - (v_service_price * v_percent / 100),
    'Code applied';
end;
$$;

grant execute on function public.preview_discount(text, uuid) to anon, authenticated;


-- ============================================================
-- migrations/0003_rls.sql
-- ============================================================

-- Row-level security and column grants.

-- Helper functions: who is the calling user?
create or replace function public.current_staff_id() returns uuid
language sql security definer stable set search_path = public as $$
  select id from public.staff where auth_user_id = auth.uid();
$$;

create or replace function public.current_staff_role() returns text
language sql security definer stable set search_path = public as $$
  select role from public.staff where auth_user_id = auth.uid();
$$;

grant execute on function public.current_staff_id()   to anon, authenticated;
grant execute on function public.current_staff_role() to anon, authenticated;

-- Enable RLS on every table.
alter table public.staff           enable row level security;
alter table public.services        enable row level security;
alter table public.shifts          enable row level security;
alter table public.shift_services  enable row level security;
alter table public.discount_codes  enable row level security;
alter table public.queue_entries   enable row level security;

-- ---------- staff ----------
create policy "anon reads active barbers"
  on public.staff for select to anon
  using (active and role = 'barber');

create policy "authenticated reads staff"
  on public.staff for select to authenticated using (true);

create policy "admin writes staff"
  on public.staff for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

-- ---------- services ----------
create policy "anon reads active services"
  on public.services for select to anon using (active);

create policy "authenticated reads services"
  on public.services for select to authenticated using (true);

create policy "admin writes services"
  on public.services for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

-- ---------- shifts ----------
create policy "anon reads open shifts"
  on public.shifts for select to anon using (ended_at is null);

create policy "authenticated reads shifts"
  on public.shifts for select to authenticated using (true);

-- Inserts/updates are funneled through start_shift / end_shift RPCs.

-- ---------- shift_services ----------
create policy "anon reads shift_services"
  on public.shift_services for select to anon using (true);

create policy "authenticated reads shift_services"
  on public.shift_services for select to authenticated using (true);

-- ---------- discount_codes ----------
-- Anon NEVER reads these (no enumeration). Validation goes through preview_discount RPC.
create policy "admin manages discount codes"
  on public.discount_codes for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

-- ---------- queue_entries ----------
-- Anon CAN read queue entries (so customers can see "you are 3rd in line"),
-- but customer_phone and discount_code_id are NOT in the column grant.
revoke all on public.queue_entries from anon;
grant select (
  id, staff_id, shift_id, queue_number, queue_date, status,
  service_id, customer_name,
  base_price_sen, final_price_sen,
  created_at, started_at, completed_at
) on public.queue_entries to anon;

create policy "anon reads queue entries"
  on public.queue_entries for select to anon using (true);

create policy "authenticated reads queue entries"
  on public.queue_entries for select to authenticated using (true);

create policy "barber updates own queue entries"
  on public.queue_entries for update to authenticated
  using (
    staff_id = public.current_staff_id()
    or public.current_staff_role() = 'admin'
  )
  with check (
    staff_id = public.current_staff_id()
    or public.current_staff_role() = 'admin'
  );


-- ============================================================
-- migrations/0004_cancel.sql
-- ============================================================

-- Allow a customer to cancel their own queue entry. Knowing the entry id
-- (only present in the customer's URL/localStorage) is treated as proof of
-- ownership. Cancelling is blocked once the entry is already in_progress.

create or replace function public.cancel_queue_entry(p_entry_id uuid)
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
  where id = p_entry_id and status = 'waiting'
  returning * into v_entry;

  if v_entry.id is null then
    raise exception 'Cannot cancel: entry is missing or no longer waiting'
      using errcode = '22000';
  end if;

  return v_entry;
end;
$$;

grant execute on function public.cancel_queue_entry(uuid) to anon, authenticated;


-- ============================================================
-- migrations/0005_staff_claim.sql
-- ============================================================

-- Add email-based linking so admin can pre-create a staff row, hand the
-- email to the new hire, and the row automatically picks up their auth_user_id
-- the first time they sign up / sign in.

alter table public.staff add column if not exists email text;
create unique index if not exists staff_email_lower_idx
  on public.staff (lower(email)) where email is not null;

-- Called by the app on every sign-in. Idempotent: if this user is already
-- linked, returns the existing staff row.
create or replace function public.claim_staff_account()
returns public.staff
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_staff public.staff;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Already linked?
  select * into v_staff from public.staff where auth_user_id = v_user_id;
  if v_staff.id is not null then
    return v_staff;
  end if;

  -- Try to claim by email match.
  select email into v_email from auth.users where id = v_user_id;

  update public.staff
  set auth_user_id = v_user_id
  where lower(email) = lower(v_email) and auth_user_id is null
  returning * into v_staff;

  return v_staff;  -- may be null if no match exists
end;
$$;

grant execute on function public.claim_staff_account() to authenticated;


-- ============================================================
-- migrations/0006_admin_operate_as.sql
-- ============================================================

-- Allow admins to start/end a shift on behalf of any barber from the shared
-- shop tablet, without needing to log in as that barber.
--
-- The optional p_staff_id parameter:
--   * NULL or matches the caller   -> caller operates on themselves
--   * differs from caller AND caller is admin -> admin operates as the target

drop function if exists public.start_shift(uuid[]);
drop function if exists public.end_shift();

create or replace function public.start_shift(
  p_service_ids uuid[],
  p_staff_id uuid default null
) returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_caller_role text;
  v_target_id uuid;
  v_shift_id uuid;
  v_shift public.shifts;
begin
  select id, role into v_caller_id, v_caller_role
  from public.staff where auth_user_id = auth.uid() and active;
  if v_caller_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_target_id := coalesce(p_staff_id, v_caller_id);
  if v_target_id <> v_caller_id and v_caller_role <> 'admin' then
    raise exception 'Not authorized to start a shift for another staff'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.staff where id = v_target_id and active) then
    raise exception 'Target staff not found or inactive' using errcode = '22000';
  end if;

  if exists (
    select 1 from public.shifts
    where staff_id = v_target_id and ended_at is null
  ) then
    raise exception 'Already on an active shift' using errcode = '22000';
  end if;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Pick at least one service' using errcode = '22000';
  end if;

  insert into public.shifts (staff_id) values (v_target_id)
  returning id into v_shift_id;

  insert into public.shift_services (shift_id, service_id)
  select v_shift_id, sid
  from unnest(p_service_ids) as sid
  where exists (select 1 from public.services where id = sid and active);

  select * into v_shift from public.shifts where id = v_shift_id;
  return v_shift;
end;
$$;

grant execute on function public.start_shift(uuid[], uuid) to authenticated;

create or replace function public.end_shift(p_staff_id uuid default null)
returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_caller_role text;
  v_target_id uuid;
  v_shift public.shifts;
begin
  select id, role into v_caller_id, v_caller_role
  from public.staff where auth_user_id = auth.uid();
  if v_caller_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_target_id := coalesce(p_staff_id, v_caller_id);
  if v_target_id <> v_caller_id and v_caller_role <> 'admin' then
    raise exception 'Not authorized to end a shift for another staff'
      using errcode = '42501';
  end if;

  update public.shifts set ended_at = now()
  where staff_id = v_target_id and ended_at is null
  returning * into v_shift;

  if v_shift.id is null then
    raise exception 'No active shift to end' using errcode = '22000';
  end if;

  return v_shift;
end;
$$;

grant execute on function public.end_shift(uuid) to authenticated;


-- ============================================================
-- migrations/0007_shared_tablet.sql
-- ============================================================

-- Shared-tablet trust model: any authenticated active staff member can
-- operate (start shift / end shift / advance queue) on behalf of any other
-- active staff member. The shop trusts whoever has access to the tablet.

drop function if exists public.start_shift(uuid[], uuid);
drop function if exists public.end_shift(uuid);
drop function if exists public.advance_queue(uuid);

create or replace function public.start_shift(
  p_service_ids uuid[],
  p_staff_id uuid default null
) returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_target_id uuid;
  v_shift_id uuid;
  v_shift public.shifts;
begin
  select id into v_caller_id
  from public.staff where auth_user_id = auth.uid() and active;
  if v_caller_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_target_id := coalesce(p_staff_id, v_caller_id);

  if not exists (select 1 from public.staff where id = v_target_id and active) then
    raise exception 'Target staff not found or inactive' using errcode = '22000';
  end if;

  if exists (
    select 1 from public.shifts
    where staff_id = v_target_id and ended_at is null
  ) then
    raise exception 'Already on an active shift' using errcode = '22000';
  end if;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Pick at least one service' using errcode = '22000';
  end if;

  insert into public.shifts (staff_id) values (v_target_id)
  returning id into v_shift_id;

  insert into public.shift_services (shift_id, service_id)
  select v_shift_id, sid from unnest(p_service_ids) as sid
  where exists (select 1 from public.services where id = sid and active);

  select * into v_shift from public.shifts where id = v_shift_id;
  return v_shift;
end;
$$;

grant execute on function public.start_shift(uuid[], uuid) to authenticated;

create or replace function public.end_shift(p_staff_id uuid default null)
returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_target_id uuid;
  v_shift public.shifts;
begin
  select id into v_caller_id from public.staff where auth_user_id = auth.uid();
  if v_caller_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_target_id := coalesce(p_staff_id, v_caller_id);

  update public.shifts set ended_at = now()
  where staff_id = v_target_id and ended_at is null
  returning * into v_shift;

  if v_shift.id is null then
    raise exception 'No active shift to end' using errcode = '22000';
  end if;

  return v_shift;
end;
$$;

grant execute on function public.end_shift(uuid) to authenticated;

create or replace function public.advance_queue(p_staff_id uuid)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_entry public.queue_entries;
begin
  select id into v_caller_id from public.staff where auth_user_id = auth.uid();
  if v_caller_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.queue_entries
  set status = 'done', completed_at = now()
  where staff_id = p_staff_id
    and queue_date = current_date
    and status = 'in_progress';

  update public.queue_entries
  set status = 'in_progress', started_at = now()
  where id = (
    select id from public.queue_entries
    where staff_id = p_staff_id
      and queue_date = current_date
      and status = 'waiting'
    order by queue_number asc
    limit 1
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function public.advance_queue(uuid) to authenticated;


-- ============================================================
-- migrations/0008_anon_staff_ops.sql
-- ============================================================

-- Staff-mode operations no longer require a logged-in user. The shop tablet
-- is the trust boundary — whoever has it can run the shift. Admin operations
-- (CRUD on staff/services/discounts) still require an authenticated admin
-- via existing RLS policies, separately enforced.

drop function if exists public.start_shift(uuid[], uuid);
drop function if exists public.end_shift(uuid);
drop function if exists public.advance_queue(uuid);

create or replace function public.start_shift(
  p_service_ids uuid[],
  p_staff_id uuid
) returns public.shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id uuid;
  v_shift public.shifts;
begin
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;

  if not exists (select 1 from public.staff where id = p_staff_id and active) then
    raise exception 'Staff not found or inactive' using errcode = '22000';
  end if;

  if exists (
    select 1 from public.shifts
    where staff_id = p_staff_id and ended_at is null
  ) then
    raise exception 'Already on an active shift' using errcode = '22000';
  end if;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Pick at least one service' using errcode = '22000';
  end if;

  insert into public.shifts (staff_id) values (p_staff_id)
  returning id into v_shift_id;

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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.shifts;
begin
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;

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

create or replace function public.advance_queue(p_staff_id uuid)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries;
begin
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;

  update public.queue_entries
  set status = 'done', completed_at = now()
  where staff_id = p_staff_id
    and queue_date = current_date
    and status = 'in_progress';

  update public.queue_entries
  set status = 'in_progress', started_at = now()
  where id = (
    select id from public.queue_entries
    where staff_id = p_staff_id
      and queue_date = current_date
      and status = 'waiting'
    order by queue_number asc
    limit 1
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function public.advance_queue(uuid) to anon, authenticated;


-- ============================================================
-- migrations/0009_products.sql
-- ============================================================

-- Retail catalog: pomades, hair products, etc. Admin manages it like services.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_sen integer not null check (price_sen >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;

-- Anon may read active products (lets us surface them on the customer site later).
create policy "anon reads active products"
  on public.products for select to anon using (active);

create policy "authenticated reads products"
  on public.products for select to authenticated using (true);

create policy "admin writes products"
  on public.products for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');


-- ============================================================
-- migrations/0010_pay.sql
-- ============================================================

-- Pay & earnings model.
--
-- Two staff employment types:
--   * full_time  — fixed monthly base salary + LOW commission per cut
--   * commission — no base salary + HIGH commission per cut
--
-- Rates are shop-wide and configurable by admin. Every time a queue entry
-- transitions to 'done', a trigger records the commission as an earnings row.

-- 1. Employment type on staff.
alter table public.staff
  add column if not exists employment_type text
    not null default 'commission'
    check (employment_type in ('full_time', 'commission'));

-- 2. Shop-wide settings (single-row table — id always = 1).
create table if not exists public.shop_settings (
  id smallint primary key default 1 check (id = 1),
  full_time_base_salary_sen integer not null default 170000
    check (full_time_base_salary_sen >= 0),
  full_time_commission_percent integer not null default 10
    check (full_time_commission_percent >= 0 and full_time_commission_percent <= 100),
  commission_only_percent integer not null default 50
    check (commission_only_percent >= 0 and commission_only_percent <= 100),
  updated_at timestamptz not null default now()
);

insert into public.shop_settings (id) values (1) on conflict (id) do nothing;

alter table public.shop_settings enable row level security;

create policy "authenticated reads shop_settings"
  on public.shop_settings for select to authenticated using (true);

create policy "admin writes shop_settings"
  on public.shop_settings for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');

-- 3. Earnings ledger. One row per commission event.
create table if not exists public.earnings (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  queue_entry_id uuid references public.queue_entries(id) on delete set null,
  amount_sen integer not null,
  percent_applied integer,
  earned_at timestamptz not null default now()
);

create index if not exists earnings_staff_date_idx
  on public.earnings (staff_id, earned_at desc);
create index if not exists earnings_queue_entry_idx
  on public.earnings (queue_entry_id);

alter table public.earnings enable row level security;

create policy "authenticated reads earnings"
  on public.earnings for select to authenticated using (true);
-- No write policy: only the security-definer trigger inserts.

-- 4. Trigger: record commission when a queue entry transitions to 'done'.
create or replace function public.record_commission_on_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_type text;
  v_ft_pct integer;
  v_co_pct integer;
  v_pct integer;
  v_commission integer;
begin
  -- Only fire on the transition INTO 'done'.
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;

  -- Idempotent: never insert a second commission row for the same entry.
  if exists (select 1 from public.earnings where queue_entry_id = new.id) then
    return new;
  end if;

  select employment_type into v_emp_type
  from public.staff where id = new.staff_id;

  select full_time_commission_percent, commission_only_percent
    into v_ft_pct, v_co_pct
  from public.shop_settings where id = 1;

  v_pct := case v_emp_type
    when 'full_time' then v_ft_pct
    else v_co_pct
  end;

  v_commission := (new.final_price_sen * v_pct) / 100;

  insert into public.earnings (staff_id, queue_entry_id, amount_sen, percent_applied)
  values (new.staff_id, new.id, v_commission, v_pct);

  return new;
end;
$$;

drop trigger if exists trg_queue_entries_record_commission on public.queue_entries;
create trigger trg_queue_entries_record_commission
  after update on public.queue_entries
  for each row
  execute function public.record_commission_on_done();


-- ============================================================
-- migrations/0011_auto_end_shifts.sql
-- ============================================================

-- Auto end any still-open shifts at midnight Malaysia time (UTC+8 = 16:00 UTC).
--
-- Uses pg_cron, which Supabase preinstalls. If the extension isn't enabled on
-- your project yet, go to Dashboard → Database → Extensions → search "pg_cron"
-- and toggle it on, then re-run this migration.

create extension if not exists pg_cron;

-- The job itself: close every shift that hasn't been ended yet.
create or replace function public.end_all_open_shifts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with closed as (
    update public.shifts
    set ended_at = now()
    where ended_at is null
    returning 1
  )
  select count(*) into v_count from closed;
  return v_count;
end;
$$;

-- Re-schedule: remove any prior version of this job first so the migration
-- is idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'end-shifts-midnight-myt') then
    perform cron.unschedule('end-shifts-midnight-myt');
  end if;
end$$;

-- 0 16 * * *  =  16:00 UTC daily  =  00:00 Asia/Kuala_Lumpur (UTC+8).
select cron.schedule(
  'end-shifts-midnight-myt',
  '0 16 * * *',
  $$select public.end_all_open_shifts()$$
);


-- ============================================================
-- migrations/0012_anon_phone_for_receipts.sql
-- ============================================================

-- Staff mode is anonymous (no login). To send a WhatsApp receipt the dashboard
-- needs to read customer_phone. Grant the anon role SELECT on that column.
--
-- Trade-off: anyone with the anon API key (which is shipped to the customer
-- web client and therefore effectively public) can query phone numbers. For
-- a single-shop deployment where the shop tablet is the trust boundary, this
-- is acceptable. Re-tighten if the project grows.

grant select (customer_phone) on public.queue_entries to anon;


-- ============================================================
-- migrations/0013_salary_payments.sql
-- ============================================================

-- Track whether an admin has paid out a given month's salary for each staff
-- member. One row per (staff, year, month). Absence of a row = due. Presence
-- with paid=true = paid.

create table if not exists public.salary_payments (
  staff_id uuid not null references public.staff(id) on delete cascade,
  period_year integer not null check (period_year >= 2020),
  period_month integer not null check (period_month >= 1 and period_month <= 12),
  paid boolean not null default true,
  paid_at timestamptz not null default now(),
  paid_amount_sen integer,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (staff_id, period_year, period_month)
);

create index if not exists salary_payments_period_idx
  on public.salary_payments (period_year, period_month);

alter table public.salary_payments enable row level security;

create policy "authenticated reads salary_payments"
  on public.salary_payments for select to authenticated using (true);

create policy "admin writes salary_payments"
  on public.salary_payments for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');


-- ============================================================
-- migrations/0014_archive_year.sql
-- ============================================================

-- Delete a year's worth of operational data (queue entries, earnings, shifts,
-- salary payments). Catalog tables (staff, services, products, discount_codes)
-- are NEVER touched — they're tiny and need to persist across years.
--
-- Only callable by an authenticated admin. Use only after exporting the
-- year's data to a PDF/CSV report and verifying the file.

create or replace function public.archive_year_delete(p_year integer)
returns table(
  deleted_queue_entries integer,
  deleted_earnings integer,
  deleted_shifts integer,
  deleted_salary_payments integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue integer := 0;
  v_earn integer := 0;
  v_shifts integer := 0;
  v_pay integer := 0;
begin
  if public.current_staff_role() <> 'admin' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if p_year is null or p_year < 2020 or p_year > extract(year from now())::integer then
    raise exception 'Invalid year' using errcode = '22000';
  end if;

  -- earnings.queue_entry_id is ON DELETE SET NULL, so we can delete in any order.
  delete from public.earnings where extract(year from earned_at) = p_year;
  get diagnostics v_earn = row_count;

  delete from public.queue_entries where extract(year from queue_date) = p_year;
  get diagnostics v_queue = row_count;

  delete from public.shifts where extract(year from started_at) = p_year;
  get diagnostics v_shifts = row_count;

  delete from public.salary_payments where period_year = p_year;
  get diagnostics v_pay = row_count;

  return query select v_queue, v_earn, v_shifts, v_pay;
end;
$$;

grant execute on function public.archive_year_delete(integer) to authenticated;


-- ============================================================
-- migrations/0015_staff_cancel.sql
-- ============================================================

-- Staff-side cancel: the barber can remove a customer from their queue,
-- including someone who's already in the chair (no-show, walked out, etc.).
-- Unlike the customer-facing cancel_queue_entry, this works for both
-- waiting AND in_progress entries.
--
-- Important: cancelling does NOT fire the record_commission_on_done trigger
-- (that trigger only runs on status -> 'done'), so the barber's earnings
-- are not credited for a cancelled customer.

create or replace function public.staff_cancel_queue_entry(p_entry_id uuid)
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
  where id = p_entry_id and status in ('waiting', 'in_progress')
  returning * into v_entry;

  if v_entry.id is null then
    raise exception 'Cannot cancel: entry is missing or already finished'
      using errcode = '22000';
  end if;

  return v_entry;
end;
$$;

-- Anonymous staff mode (shared tablet trust boundary) can call this, matching
-- the pattern used by start_shift / end_shift / advance_queue.
grant execute on function public.staff_cancel_queue_entry(uuid) to anon, authenticated;


-- ============================================================
-- migrations/0016_staff_adjust_price.sql
-- ============================================================

-- Barber-side price adjustment while serving a customer: an add-on surcharge
-- (e.g. +RM3 for a beard trim the customer asked for) or a goodwill reduction
-- (e.g. -RM5 because they weren't satisfied).
--
-- The adjustment changes the PRE-discount subtotal, so any % discount the
-- customer used re-applies to the new subtotal — the discount covers the add-on
-- too (this is what the customer ultimately pays, so it should be discounted).
--
--   base_price_sen        = catalog service price (unchanged)
--   price_adjustment_sen  = barber's running net +/- on the subtotal (this column)
--   subtotal              = base_price_sen + price_adjustment_sen
--   final_price_sen       = subtotal - discount = what the customer is charged
--
-- Commission is recorded from final_price_sen when the entry hits 'done', so it
-- follows the adjusted price automatically.

alter table public.queue_entries
  add column if not exists price_adjustment_sen integer not null default 0;

-- Anon (customer site + shared-tablet staff mode) reads queue rows via an
-- explicit column grant; the new column must be added to it to be visible.
grant select (price_adjustment_sen) on public.queue_entries to anon;

create or replace function public.staff_adjust_entry_price(
  p_entry_id uuid,
  p_delta_sen integer
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries;
  v_percent integer := 0;
  v_new_adjustment integer;
  v_gross integer;
  v_final integer;
begin
  -- Only adjustable while the cut is still open (commission locks at 'done').
  select * into v_entry
  from public.queue_entries
  where id = p_entry_id and status in ('waiting', 'in_progress')
  for update;

  if v_entry.id is null then
    raise exception 'Cannot adjust: entry is missing or already finished'
      using errcode = '22000';
  end if;

  -- Current discount percent for this entry, if any (0 when no code).
  if v_entry.discount_code_id is not null then
    select coalesce(percent, 0) into v_percent
    from public.discount_codes where id = v_entry.discount_code_id;
    v_percent := coalesce(v_percent, 0);
  end if;

  v_new_adjustment := v_entry.price_adjustment_sen + p_delta_sen;
  v_gross := v_entry.base_price_sen + v_new_adjustment;

  if v_gross < 0 then
    raise exception 'Adjustment would make the price negative'
      using errcode = '22000';
  end if;

  -- Integer truncation, matching create_queue_entry's discount math.
  v_final := v_gross - (v_gross * v_percent / 100);

  update public.queue_entries
  set price_adjustment_sen = v_new_adjustment,
      final_price_sen = v_final
  where id = p_entry_id
  returning * into v_entry;

  return v_entry;
end;
$$;

-- Anonymous staff mode (shared tablet) can call this, matching the pattern used
-- by staff_cancel_queue_entry / advance_queue.
grant execute on function public.staff_adjust_entry_price(uuid, integer) to anon, authenticated;


-- ============================================================
-- migrations/0017_backend_toggle.sql
-- ============================================================

-- Mock/Live backend toggle — the "control plane".
--
-- One Supabase project is designated the permanent CONTROL project (the old
-- project). It holds a single flag row that decides which backend every client
-- (the Vercel web + the staff/admin app) talks to:
--
--   active_backend = 'mock'  -> clients use the MOCK project  (the old project)
--   active_backend = 'live'  -> clients use the LIVE project  (the real shop)
--
-- Clients read this flag once at startup (anon, before any login) and then point
-- their main Supabase client at the chosen backend. If the control project is
-- unreachable, clients fail safe to 'live' so the real shop never breaks.
--
-- Run this migration on the CONTROL project (the old one). Running it on the
-- live project too is harmless and keeps the two schemas identical.

create table if not exists public.app_control (
  id smallint primary key default 1 check (id = 1),
  active_backend text not null default 'live'
    check (active_backend in ('mock', 'live')),
  updated_at timestamptz not null default now()
);

insert into public.app_control (id) values (1) on conflict (id) do nothing;

alter table public.app_control enable row level security;

-- Anyone may READ the flag — clients need it at startup, before any login.
create policy "anon reads app_control"
  on public.app_control for select to anon using (true);
create policy "authenticated reads app_control"
  on public.app_control for select to authenticated using (true);

-- Writes go ONLY through the RPC below (no direct write policy). The toggle UI
-- is admin-only and guarded by a confirm dialog, matching the shared-tablet
-- trust model already used by the other anon staff RPCs.
create or replace function public.set_active_backend(p_value text)
returns public.app_control
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.app_control;
begin
  if p_value is null or p_value not in ('mock', 'live') then
    raise exception 'Invalid backend: %', p_value using errcode = '22000';
  end if;

  update public.app_control
  set active_backend = p_value, updated_at = now()
  where id = 1
  returning * into v;

  return v;
end;
$$;

grant execute on function public.set_active_backend(text) to anon, authenticated;

