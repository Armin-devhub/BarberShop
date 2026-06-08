-- Admin-configurable shop closing time drives the auto-end-shift cron.
--
-- Until now the midnight job (0011) fired at a hard-coded 16:00 UTC. This lets the
-- admin pick the shop's closing time; the cron is rescheduled to fire then, so any
-- forgotten shift/break auto-closes at closing time instead of midnight.
--
-- Times are stored and entered in Malaysia time (Asia/Kuala_Lumpur, UTC+8). pg_cron
-- runs on UTC, so we convert MYT -> UTC (subtract 8h, wraps within the day) when
-- building the cron expression.
--
-- Default stays '00:00' (midnight) so behaviour is unchanged until an admin sets it.
-- Run on the same project(s) as 0011/0022 (the backend that holds the shifts).

alter table public.app_control
  add column if not exists shop_close_time time not null default '00:00';

-- (Re)schedule the auto-end job to fire at the configured closing time. Idempotent:
-- removes the legacy midnight job and any prior version of this one first. Wrapped
-- so a project without pg_cron still saves the setting — enable pg_cron and call
-- this again to activate the schedule.
create or replace function public.reschedule_shop_close_job()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_close time;
  v_utc time;
  v_cron text;
begin
  select shop_close_time into v_close from public.app_control where id = 1;
  v_close := coalesce(v_close, time '00:00');
  v_utc := v_close - interval '8 hours'; -- MYT (UTC+8) -> UTC, wraps within 24h
  v_cron := format('%s %s * * *', extract(minute from v_utc)::int, extract(hour from v_utc)::int);

  begin
    if exists (select 1 from cron.job where jobname = 'end-shifts-midnight-myt') then
      perform cron.unschedule('end-shifts-midnight-myt');
    end if;
    if exists (select 1 from cron.job where jobname = 'end-shifts-shop-close-myt') then
      perform cron.unschedule('end-shifts-shop-close-myt');
    end if;
    perform cron.schedule(
      'end-shifts-shop-close-myt',
      v_cron,
      $cron$select public.end_all_open_shifts()$cron$
    );
  exception when others then
    null; -- pg_cron not installed/enabled; setting saved, schedule skipped.
  end;
end;
$$;

-- Admin RPC: set the closing time (HH:MM, Malaysia time) and reschedule the job.
-- Operator-gated like the other admin/control RPCs.
create or replace function public.set_shop_close_time(p_time text)
returns public.app_control
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.app_control;
  v_time time;
begin
  perform public.assert_operator();
  begin
    v_time := p_time::time;
  exception when others then
    raise exception 'Invalid time: %', p_time using errcode = '22000';
  end;

  update public.app_control
  set shop_close_time = v_time, updated_at = now()
  where id = 1
  returning * into v;

  perform public.reschedule_shop_close_job();
  return v;
end;
$$;

grant execute on function public.set_shop_close_time(text) to anon, authenticated;

-- Apply the schedule to match the current (default) close time.
select public.reschedule_shop_close_job();
