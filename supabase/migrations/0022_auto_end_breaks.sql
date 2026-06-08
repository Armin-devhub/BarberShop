-- Fix: the midnight auto-end job (0011) closes open shifts but was written before
-- breaks existed (0020), so it left open breaks running forever. An un-ended break
-- keeps counting toward now() in attendance, which can exceed the shift length and
-- zero out "net worked". Make the job close open breaks too, exactly like the
-- manual end_shift() does.
--
-- Still fires at midnight Malaysia time (16:00 UTC) via the existing pg_cron job;
-- this only redefines the function body, so no re-scheduling is needed.

create or replace function public.end_all_open_shifts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Close any open break first (matches end_shift): a break whose timer never
  -- started counts as zero by setting started_at = ended_at.
  update public.breaks
  set ended_at = now(), started_at = coalesce(started_at, now())
  where ended_at is null;

  with closed as (
    update public.shifts
    set ended_at = now()
    where ended_at is null
    returning 1
  )
  select count(*) into v_count from closed;
  return v_count;
end;
$$;
