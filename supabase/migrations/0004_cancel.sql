-- Allow a customer to cancel their own queue entry. Knowing the entry id
-- (only present in the customer's URL/localStorage) is treated as proof of
-- ownership. Cancelling is blocked once the entry is already in_progress.

create or replace function public.cancel_queue_entry(p_entry_id uuid)
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
  where id = p_entry_id and status = 'waiting'
  returning * into v_entry;

  if v_entry.id is null then
    raise exception 'Cannot cancel: entry is missing or no longer waiting'
      using errcode = '22000';
  end if;

  return v_entry;
end;
$$;

grant execute on function public.cancel_queue_entry(uuid) to anon, authenticated;
