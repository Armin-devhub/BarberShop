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
