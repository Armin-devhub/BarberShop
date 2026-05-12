-- Dev-only fixtures: simulate an on-shift barber so you can test the customer
-- web flow before the staff app exists.
--
-- Run AFTER 0001_schema.sql, 0002_functions.sql, 0003_rls.sql, and seed.sql.
-- Safe to re-run: every insert is idempotent.
--
-- DELETE this file (or skip it) once the Expo staff app is wired up and your
-- real barbers can clock in for themselves.

-- Two demo barbers (no auth_user_id yet — they'll get one when they sign up).
insert into public.staff (name, phone, role)
select 'Hafiz (demo)', '60123456001', 'barber'
where not exists (select 1 from public.staff where name = 'Hafiz (demo)');

insert into public.staff (name, phone, role)
select 'Imran (demo)', '60123456002', 'barber'
where not exists (select 1 from public.staff where name = 'Imran (demo)');

-- Open shift for each demo barber, if they don't already have one.
insert into public.shifts (staff_id)
select s.id from public.staff s
where s.name in ('Hafiz (demo)', 'Imran (demo)')
  and not exists (
    select 1 from public.shifts sh
    where sh.staff_id = s.id and sh.ended_at is null
  );

-- Link every active service to each demo barber's open shift.
insert into public.shift_services (shift_id, service_id)
select sh.id, sv.id
from public.shifts sh
join public.staff s  on s.id = sh.staff_id and s.name in ('Hafiz (demo)', 'Imran (demo)')
join public.services sv on sv.active
where sh.ended_at is null
on conflict (shift_id, service_id) do nothing;
