-- Auto end any still-open shifts at midnight Malaysia time (UTC+8 = 16:00 UTC).
--
-- Uses pg_cron, which Supabase preinstalls. If the extension isn't enabled on
-- your project yet, go to Dashboard → Database → Extensions → search "pg_cron"
-- and toggle it on, then re-run this migration.

create extension if not exists pg_cron;

-- The job itself: close every shift that hasn't been ended yet.
create or replace function public.end_all_open_shifts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
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

-- Re-schedule: remove any prior version of this job first so the migration
-- is idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'end-shifts-midnight-myt') then
    perform cron.unschedule('end-shifts-midnight-myt');
  end if;
end$$;

-- 0 16 * * *  =  16:00 UTC daily  =  00:00 Asia/Kuala_Lumpur (UTC+8).
select cron.schedule(
  'end-shifts-midnight-myt',
  '0 16 * * *',
  $$select public.end_all_open_shifts()$$
);
