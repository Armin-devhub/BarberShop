-- Add email-based linking so admin can pre-create a staff row, hand the
-- email to the new hire, and the row automatically picks up their auth_user_id
-- the first time they sign up / sign in.

alter table public.staff add column if not exists email text;
create unique index if not exists staff_email_lower_idx
  on public.staff (lower(email)) where email is not null;

-- Called by the app on every sign-in. Idempotent: if this user is already
-- linked, returns the existing staff row.
create or replace function public.claim_staff_account()
returns public.staff
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_staff public.staff;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Already linked?
  select * into v_staff from public.staff where auth_user_id = v_user_id;
  if v_staff.id is not null then
    return v_staff;
  end if;

  -- Try to claim by email match.
  select email into v_email from auth.users where id = v_user_id;

  update public.staff
  set auth_user_id = v_user_id
  where lower(email) = lower(v_email) and auth_user_id is null
  returning * into v_staff;

  return v_staff;  -- may be null if no match exists
end;
$$;

grant execute on function public.claim_staff_account() to authenticated;
