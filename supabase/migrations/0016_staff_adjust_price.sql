-- Barber-side price adjustment while serving a customer: an add-on surcharge
-- (e.g. +RM3 for a beard trim the customer asked for) or a goodwill reduction
-- (e.g. -RM5 because they weren't satisfied).
--
-- The adjustment changes the PRE-discount subtotal, so any % discount the
-- customer used re-applies to the new subtotal — the discount covers the add-on
-- too (this is what the customer ultimately pays, so it should be discounted).
--
--   base_price_sen        = catalog service price (unchanged)
--   price_adjustment_sen  = barber's running net +/- on the subtotal (this column)
--   subtotal              = base_price_sen + price_adjustment_sen
--   final_price_sen       = subtotal - discount = what the customer is charged
--
-- Commission is recorded from final_price_sen when the entry hits 'done', so it
-- follows the adjusted price automatically.

alter table public.queue_entries
  add column if not exists price_adjustment_sen integer not null default 0;

-- Anon (customer site + shared-tablet staff mode) reads queue rows via an
-- explicit column grant; the new column must be added to it to be visible.
grant select (price_adjustment_sen) on public.queue_entries to anon;

create or replace function public.staff_adjust_entry_price(
  p_entry_id uuid,
  p_delta_sen integer
)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries;
  v_percent integer := 0;
  v_new_adjustment integer;
  v_gross integer;
  v_final integer;
begin
  -- Only adjustable while the cut is still open (commission locks at 'done').
  select * into v_entry
  from public.queue_entries
  where id = p_entry_id and status in ('waiting', 'in_progress')
  for update;

  if v_entry.id is null then
    raise exception 'Cannot adjust: entry is missing or already finished'
      using errcode = '22000';
  end if;

  -- Current discount percent for this entry, if any (0 when no code).
  if v_entry.discount_code_id is not null then
    select coalesce(percent, 0) into v_percent
    from public.discount_codes where id = v_entry.discount_code_id;
    v_percent := coalesce(v_percent, 0);
  end if;

  v_new_adjustment := v_entry.price_adjustment_sen + p_delta_sen;
  v_gross := v_entry.base_price_sen + v_new_adjustment;

  if v_gross < 0 then
    raise exception 'Adjustment would make the price negative'
      using errcode = '22000';
  end if;

  -- Integer truncation, matching create_queue_entry's discount math.
  v_final := v_gross - (v_gross * v_percent / 100);

  update public.queue_entries
  set price_adjustment_sen = v_new_adjustment,
      final_price_sen = v_final
  where id = p_entry_id
  returning * into v_entry;

  return v_entry;
end;
$$;

-- Anonymous staff mode (shared tablet) can call this, matching the pattern used
-- by staff_cancel_queue_entry / advance_queue.
grant execute on function public.staff_adjust_entry_price(uuid, integer) to anon, authenticated;
