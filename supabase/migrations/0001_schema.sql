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
