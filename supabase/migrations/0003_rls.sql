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
