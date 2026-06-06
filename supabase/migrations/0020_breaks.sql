-- Breaks + manual queue advance.
--
-- Manual flow: completing the current customer ('Done') no longer auto-promotes
-- the next one. The barber taps 'Start next customer' to begin the next cut.
--
-- Break: the barber taps Break to rest/eat/pray. They are hidden from customers
-- immediately (can't be selected) and stay hidden until 'Continue shift'. The
-- remaining queue is NOT cleared — the barber finishes anyone already in line.
-- The break TIMER only starts once that queue is empty (fair to the barber), so
-- it measures real rest time. Attendance subtracts break time from shift time.

-- 1. Breaks table. requested_at = when Break was tapped (hidden-from-web starts);
--    started_at = when the timer begins (queue cleared); ended_at = Continue shift.
create table if not exists public.breaks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete cascade,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

-- A barber can only be on one break at a time.
create unique index if not exists breaks_one_open_per_staff
  on public.breaks (staff_id) where ended_at is null;

create index if not exists breaks_staff_started_idx
  on public.breaks (staff_id, started_at);

alter table public.breaks enable row level security;

drop policy if exists "anon reads breaks" on public.breaks;
create policy "anon reads breaks" on public.breaks for select to anon using (true);

drop policy if exists "authenticated reads breaks" on public.breaks;
create policy "authenticated reads breaks" on public.breaks for select to authenticated using (true);

grant select on public.breaks to anon, authenticated;

-- Live updates so the customer barber list drops an on-break barber instantly.
do $$
begin
  begin
    alter publication supabase_realtime add table public.breaks;
  exception when duplicate_object then null;
  end;
end $$;

-- 2. Hide on-break barbers from the customer-facing views.
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
where s.ended_at is null and st.active and st.role = 'barber'
  and not exists (
    select 1 from public.breaks b where b.staff_id = st.id and b.ended_at is null
  );

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
where s.ended_at is null and sv.active and st.active
  and not exists (
    select 1 from public.breaks b where b.staff_id = st.id and b.ended_at is null
  );

-- 3. Reject joining an on-break barber's queue (defensive — the UI already hides
--    them). create_queue_entry recreated from 0019 + this guard.
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
  v_is_custom boolean := p_service_id is null;
begin
  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'Customer name is required' using errcode = '22000';
  end if;
  if length(trim(coalesce(p_customer_phone, ''))) = 0 then
    raise exception 'Customer phone is required' using errcode = '22000';
  end if;

  select id into v_shift_id
  from public.shifts
  where staff_id = p_staff_id and ended_at is null
  order by started_at desc
  limit 1;

  if v_shift_id is null then
    raise exception 'Barber is not currently on shift' using errcode = '22000';
  end if;

  if exists (select 1 from public.breaks where staff_id = p_staff_id and ended_at is null) then
    raise exception 'Barber is on a break right now' using errcode = '22000';
  end if;

  if not v_is_custom then
    if not exists (
      select 1 from public.shift_services
      where shift_id = v_shift_id and service_id = p_service_id
    ) then
      raise exception 'This barber does not offer that service today' using errcode = '22000';
    end if;

    select price_sen into v_service_price
    from public.services where id = p_service_id and active;

    if v_service_price is null then
      raise exception 'Service not found or inactive' using errcode = '22000';
    end if;

    v_base_price := v_service_price;
    v_final_price := v_service_price;
  else
    v_base_price := null;
    v_final_price := null;
  end if;

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

    if not v_is_custom then
      v_final_price := v_service_price - (v_service_price * v_discount_percent / 100);
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_staff_id::text || current_date::text)
  );

  select coalesce(max(queue_number), 0) + 1 into v_queue_number
  from public.queue_entries
  where staff_id = p_staff_id and queue_date = current_date;

  insert into public.queue_entries (
    staff_id, shift_id, customer_name, customer_phone,
    service_id, discount_code_id, discount_percent,
    queue_number, queue_date,
    base_price_sen, final_price_sen
  ) values (
    p_staff_id, v_shift_id, trim(p_customer_name), trim(p_customer_phone),
    p_service_id, v_discount_id, v_discount_percent,
    v_queue_number, current_date,
    v_base_price, v_final_price
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function public.create_queue_entry(uuid, text, text, uuid, text)
  to anon, authenticated;

-- 4. Complete the current customer WITHOUT promoting the next (manual flow).
create or replace function public.complete_current_entry(p_staff_id uuid)
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
    and status = 'in_progress'
  returning * into v_entry;

  return v_entry; -- null if no one was in the chair
end;
$$;

grant execute on function public.complete_current_entry(uuid) to anon, authenticated;

-- 5. Promote the next waiting customer (only if the chair is empty).
create or replace function public.start_next_entry(p_staff_id uuid)
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

  if exists (
    select 1 from public.queue_entries
    where staff_id = p_staff_id and queue_date = current_date and status = 'in_progress'
  ) then
    raise exception 'Finish the current customer first' using errcode = '22000';
  end if;

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

grant execute on function public.start_next_entry(uuid) to anon, authenticated;

-- 6. Start a break. Hidden from customers immediately. The timer starts now only
--    if the queue is already empty; otherwise it starts when the queue clears.
create or replace function public.start_break(p_staff_id uuid)
returns public.breaks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id uuid;
  v_has_queue boolean;
  v_break public.breaks;
begin
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;

  select id into v_shift_id
  from public.shifts
  where staff_id = p_staff_id and ended_at is null
  order by started_at desc
  limit 1;

  if v_shift_id is null then
    raise exception 'Not on an active shift' using errcode = '22000';
  end if;

  if exists (select 1 from public.breaks where staff_id = p_staff_id and ended_at is null) then
    raise exception 'Already on a break' using errcode = '22000';
  end if;

  select exists (
    select 1 from public.queue_entries
    where staff_id = p_staff_id and queue_date = current_date
      and status in ('waiting', 'in_progress')
  ) into v_has_queue;

  insert into public.breaks (staff_id, shift_id, requested_at, started_at)
  values (
    p_staff_id, v_shift_id, now(),
    case when v_has_queue then null else now() end
  )
  returning * into v_break;

  return v_break;
end;
$$;

grant execute on function public.start_break(uuid) to anon, authenticated;

-- 7. End the break ('Continue shift'). If the timer never started (queue wasn't
--    cleared), the break counts as zero.
create or replace function public.end_break(p_staff_id uuid)
returns public.breaks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_break public.breaks;
begin
  if p_staff_id is null then
    raise exception 'Staff is required' using errcode = '22000';
  end if;

  update public.breaks
  set ended_at = now(),
      started_at = coalesce(started_at, now())
  where staff_id = p_staff_id and ended_at is null
  returning * into v_break;

  if v_break.id is null then
    raise exception 'No active break' using errcode = '22000';
  end if;

  return v_break;
end;
$$;

grant execute on function public.end_break(uuid) to anon, authenticated;

-- 8. When a barber's queue empties, start the timer of any pending break.
create or replace function public.maybe_start_pending_break()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status not in ('done', 'cancelled') then
    return new;
  end if;

  update public.breaks b
  set started_at = now()
  where b.staff_id = new.staff_id
    and b.ended_at is null
    and b.started_at is null
    and not exists (
      select 1 from public.queue_entries qe
      where qe.staff_id = new.staff_id
        and qe.queue_date = current_date
        and qe.status in ('waiting', 'in_progress')
    );

  return new;
end;
$$;

drop trigger if exists trg_queue_maybe_start_break on public.queue_entries;
create trigger trg_queue_maybe_start_break
  after update of status on public.queue_entries
  for each row
  execute function public.maybe_start_pending_break();

-- 9. Ending a shift also closes any open break.
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

  update public.breaks
  set ended_at = now(), started_at = coalesce(started_at, now())
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
