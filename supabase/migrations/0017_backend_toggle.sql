-- Mock/Live backend toggle — the "control plane".
--
-- One Supabase project is designated the permanent CONTROL project (the old
-- project). It holds a single flag row that decides which backend every client
-- (the Vercel web + the staff/admin app) talks to:
--
--   active_backend = 'mock'  -> clients use the MOCK project  (the old project)
--   active_backend = 'live'  -> clients use the LIVE project  (the real shop)
--
-- Clients read this flag once at startup (anon, before any login) and then point
-- their main Supabase client at the chosen backend. If the control project is
-- unreachable, clients fail safe to 'live' so the real shop never breaks.
--
-- Run this migration on the CONTROL project (the old one). Running it on the
-- live project too is harmless and keeps the two schemas identical.

create table if not exists public.app_control (
  id smallint primary key default 1 check (id = 1),
  active_backend text not null default 'live'
    check (active_backend in ('mock', 'live')),
  updated_at timestamptz not null default now()
);

insert into public.app_control (id) values (1) on conflict (id) do nothing;

alter table public.app_control enable row level security;

-- Anyone may READ the flag — clients need it at startup, before any login.
create policy "anon reads app_control"
  on public.app_control for select to anon using (true);
create policy "authenticated reads app_control"
  on public.app_control for select to authenticated using (true);

-- Writes go ONLY through the RPC below (no direct write policy). The toggle UI
-- is admin-only and guarded by a confirm dialog, matching the shared-tablet
-- trust model already used by the other anon staff RPCs.
create or replace function public.set_active_backend(p_value text)
returns public.app_control
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.app_control;
begin
  if p_value is null or p_value not in ('mock', 'live') then
    raise exception 'Invalid backend: %', p_value using errcode = '22000';
  end if;

  update public.app_control
  set active_backend = p_value, updated_at = now()
  where id = 1
  returning * into v;

  return v;
end;
$$;

grant execute on function public.set_active_backend(text) to anon, authenticated;
