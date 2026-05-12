-- Retail catalog: pomades, hair products, etc. Admin manages it like services.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_sen integer not null check (price_sen >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;

-- Anon may read active products (lets us surface them on the customer site later).
create policy "anon reads active products"
  on public.products for select to anon using (active);

create policy "authenticated reads products"
  on public.products for select to authenticated using (true);

create policy "admin writes products"
  on public.products for all to authenticated
  using (public.current_staff_role() = 'admin')
  with check (public.current_staff_role() = 'admin');
