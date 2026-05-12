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
