-- "Custom Service" — a customer joins a barber's queue WITHOUT picking a catalog
-- service or seeing a price. The barber sets the final price when finishing. Any
-- discount code the customer entered still applies, to the barber-entered price.
--
-- Representation:
--   service_id IS NULL        → custom service (no catalog service)
--   final_price_sen IS NULL   → price not set by the barber yet
--   discount_percent          → % to apply when the barber sets the price (locked
--                               at join time so later code edits don't change it)

-- 1. Allow custom / not-yet-priced entries.
alter table public.queue_entries
  alter column service_id drop not null,
  alter column base_price_sen drop not null,
  alter column final_price_sen drop not null;

alter table public.queue_entries
  add column if not exists discount_percent integer
    check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100));

-- 2. Commission trigger: skip if the price isn't set yet (custom entry that was
--    somehow completed without a price — defensive; the UI blocks this).
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
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;
  if new.final_price_sen is null then
    return new; -- no price → no commission
  end if;
  if exists (select 1 from public.earnings where queue_entry_id = new.id) then
    return new;
  end if;

  select employment_type into v_emp_type from public.staff where id = new.staff_id;
  select full_time_commission_percent, commission_only_percent
    into v_ft_pct, v_co_pct
  from public.shop_settings where id = 1;

  v_pct := case v_emp_type when 'full_time' then v_ft_pct else v_co_pct end;
  v_commission := (new.final_price_sen * v_pct) / 100;

  insert into public.earnings (staff_id, queue_entry_id, amount_sen, percent_applied)
  values (new.staff_id, new.id, v_commission, v_pct);

  return new;
end;
$$;

-- 3. create_queue_entry: support a NULL service_id (custom service). The discount
--    code is still validated + redeemed and its percent is stored for later.
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

  -- Verify barber is currently on shift.
  select id into v_shift_id
  from public.shifts
  where staff_id = p_staff_id and ended_at is null
  order by started_at desc
  limit 1;

  if v_shift_id is null then
    raise exception 'Barber is not currently on shift' using errcode = '22000';
  end if;

  if not v_is_custom then
    -- Verify barber offers this catalog service today.
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
    -- Custom service: no catalog price; the barber sets it later.
    v_base_price := null;
    v_final_price := null;
  end if;

  -- Optional discount. Validated + redeemed at join time for both paths.
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

    -- For a catalog service we can apply the discount now; for custom we store
    -- the percent and apply it when the barber sets the price.
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

-- 4. Barber sets the final price for a custom entry. Applies the stored discount
--    percent. Mirrors staff_adjust_entry_price's anon-callable pattern.
create or replace function public.staff_set_custom_price(
  p_entry_id uuid,
  p_price_sen integer
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries;
  v_percent integer := 0;
  v_final integer;
begin
  if p_price_sen is null or p_price_sen < 0 then
    raise exception 'Price must be zero or more' using errcode = '22000';
  end if;

  select * into v_entry
  from public.queue_entries
  where id = p_entry_id
    and service_id is null
    and status in ('waiting', 'in_progress')
  for update;

  if v_entry.id is null then
    raise exception 'Cannot set price: entry is missing, not custom, or already finished'
      using errcode = '22000';
  end if;

  v_percent := coalesce(v_entry.discount_percent, 0);
  v_final := p_price_sen - (p_price_sen * v_percent / 100);

  update public.queue_entries
  set base_price_sen = p_price_sen,
      final_price_sen = v_final,
      price_adjustment_sen = 0
  where id = p_entry_id
  returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function public.staff_set_custom_price(uuid, integer) to anon, authenticated;

-- 5. preview_discount: allow a NULL service_id (custom) → validate the code only,
--    returning the percent with null prices.
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
  select dc.percent into v_percent
  from public.discount_codes dc
  where upper(dc.code) = upper(trim(p_code))
    and dc.active
    and (dc.expires_at is null or dc.expires_at > now())
    and (dc.max_uses is null or dc.used_count < dc.max_uses);

  -- Custom service: no price to preview, just confirm the code is valid.
  if p_service_id is null then
    if v_percent is null then
      return query select false, null::integer, null::integer, null::integer, 'Invalid or expired code';
    else
      return query select true, v_percent, null::integer, null::integer, 'Code applied';
    end if;
    return;
  end if;

  select price_sen into v_service_price
  from public.services where id = p_service_id and active;

  if v_service_price is null then
    return query select false, null::integer, null::integer, null::integer, 'Service not found';
    return;
  end if;

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
