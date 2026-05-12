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
