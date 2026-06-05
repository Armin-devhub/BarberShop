-- Staff-side cancel: the barber can remove a customer from their queue,
-- including someone who's already in the chair (no-show, walked out, etc.).
-- Unlike the customer-facing cancel_queue_entry, this works for both
-- waiting AND in_progress entries.
--
-- Important: cancelling does NOT fire the record_commission_on_done trigger
-- (that trigger only runs on status -> 'done'), so the barber's earnings
-- are not credited for a cancelled customer.

create or replace function public.staff_cancel_queue_entry(p_entry_id uuid)
returns public.queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.queue_entries;
begin
  update public.queue_entries
  set status = 'cancelled', completed_at = now()
  where id = p_entry_id and status in ('waiting', 'in_progress')
  returning * into v_entry;

  if v_entry.id is null then
    raise exception 'Cannot cancel: entry is missing or already finished'
      using errcode = '22000';
  end if;

  return v_entry;
end;
$$;

-- Anonymous staff mode (shared tablet trust boundary) can call this, matching
-- the pattern used by start_shift / end_shift / advance_queue.
grant execute on function public.staff_cancel_queue_entry(uuid) to anon, authenticated;
