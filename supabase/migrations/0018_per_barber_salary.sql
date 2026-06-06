-- Per-barber base salary + per-month overrides.
--
-- Before: a single shop-wide full_time_base_salary_sen applied to every
-- full-time barber, every month.
--
-- After:
--   * staff.base_salary_sen — each full-timer's own STANDARD monthly base.
--     NULL means "use the shop-wide default" (shop_settings.full_time_base_salary_sen),
--     so existing barbers keep working with no data change.
--   * salary_overrides — a per-(barber, month) override for one-off situations
--     like unpaid leave. A row here wins over the standard for that month only.
--
-- "Owed base" for a (barber, month) is computed in the app as:
--     override.base_sen              if an override row exists, else
--     standard base                  if the barber started >=1 shift that month, else
--     0
-- where standard base = staff.base_salary_sen ?? shop_settings.full_time_base_salary_sen.

-- 1. Per-barber standard monthly base salary (full-time). NULL = use shop default.
alter table public.staff
  add column if not exists base_salary_sen integer
    check (base_salary_sen is null or base_salary_sen >= 0);

-- 2. Per-(barber, month) base salary override. Presence overrides the standard
--    for that one month (e.g. unpaid leave). Absence = fall back to standard.
create table if not exists public.salary_overrides (
  staff_id uuid not null references public.staff(id) on delete cascade,
  period_year integer not null check (period_year >= 2020),
  period_month integer not null check (period_month >= 1 and period_month <= 12),
  base_sen integer not null check (base_sen >= 0),
  updated_at timestamptz not null default now(),
  primary key (staff_id, period_year, period_month)
);

create index if not exists salary_overrides_period_idx
  on public.salary_overrides (period_year, period_month);

alter table public.salary_overrides enable row level security;

drop policy if exists "authenticated reads salary_overrides" on public.salary_overrides;
create policy "authenticated reads salary_overrides"
  on public.salary_overrides for select to authenticated using (true);

drop policy if exists "admin writes salary_overrides" on public.salary_overrides;
create policy "admin writes salary_overrides"
  on public.salary_overrides for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');
