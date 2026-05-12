-- Sample data for development and demos.
-- Safe to re-run: every insert uses ON CONFLICT.

insert into public.services (name, price_sen, duration_minutes) values
  ('Buzz Cut',         2000, 20),
  ('Undercut',         3500, 35),
  ('Uppercut',         3500, 35),
  ('Beard Trim',       1500, 15),
  ('Haircut + Beard',  4500, 45),
  ('Kids Cut',         1800, 20)
on conflict (name) do nothing;

insert into public.discount_codes (code, percent, max_uses, expires_at) values
  ('WELCOME10', 10, null, null),
  ('LAUNCH20', 20, 100,  now() + interval '30 days')
on conflict (code) do nothing;

-- NOTE: staff rows are NOT seeded — bootstrap your first admin manually.
-- See README.md → "Create the first admin".
