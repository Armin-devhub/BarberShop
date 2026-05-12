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
