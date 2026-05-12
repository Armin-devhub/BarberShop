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
