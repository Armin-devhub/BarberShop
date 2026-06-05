-- Delete a year's worth of operational data (queue entries, earnings, shifts,
-- salary payments). Catalog tables (staff, services, products, discount_codes)
-- are NEVER touched — they're tiny and need to persist across years.
--
-- Only callable by an authenticated admin. Use only after exporting the
-- year's data to a PDF/CSV report and verifying the file.

create or replace function public.archive_year_delete(p_year integer)
returns table(
  deleted_queue_entries integer,
  deleted_earnings integer,
  deleted_shifts integer,
  deleted_salary_payments integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queue integer := 0;
  v_earn integer := 0;
  v_shifts integer := 0;
  v_pay integer := 0;
begin
  if public.current_staff_role() <> 'admin' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if p_year is null or p_year < 2020 or p_year > extract(year from now())::integer then
    raise exception 'Invalid year' using errcode = '22000';
  end if;

  -- earnings.queue_entry_id is ON DELETE SET NULL, so we can delete in any order.
  delete from public.earnings where extract(year from earned_at) = p_year;
  get diagnostics v_earn = row_count;

  delete from public.queue_entries where extract(year from queue_date) = p_year;
  get diagnostics v_queue = row_count;

  delete from public.shifts where extract(year from started_at) = p_year;
  get diagnostics v_shifts = row_count;

  delete from public.salary_payments where period_year = p_year;
  get diagnostics v_pay = row_count;

  return query select v_queue, v_earn, v_shifts, v_pay;
end;
$$;

grant execute on function public.archive_year_delete(integer) to authenticated;
