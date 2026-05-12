# BarberShop Queue & Booking System

Single-shop queue and booking system for a barbershop in Malaysia.

## Architecture

- **`web/`** — Next.js 15 (App Router) customer-facing site. Deployed to Vercel. Customers scan a QR code in the shop, this is what they land on.
- **`app/`** — Expo (React Native) staff & admin app. Two modes: barbers clock in / advance queue / send WhatsApp receipts; admins manage staff, services, and discount codes.
- **`supabase/`** — Postgres schema, RPC functions, RLS policies, and seed data.
- **`shared/`** — TypeScript types shared between `web/` and `app/`.

## Stack

| Layer | Tech |
|---|---|
| Customer web | Next.js 15 App Router, React 19, Tailwind CSS |
| Staff/admin app | Expo SDK 51+, React Native, expo-router |
| Backend | Supabase (Postgres + Auth + Realtime) |
| WhatsApp | `wa.me` click-to-chat links (no API cost) |
| Hosting | Vercel (web) + Expo EAS (app) |

## First-time setup

### 1. Prerequisites

- Node.js 20+
- npm
- Supabase account ([supabase.com](https://supabase.com))
- Supabase CLI (optional but recommended): `npm i -g supabase`

### 2. Create Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Save the **Project URL** and **anon public key** (Settings → API).
3. Save the **service_role key** (server-side only — never put it in the Expo app or web client).

### 3. Apply the schema

**Option A — Supabase Dashboard (quickest):**
Open SQL Editor and run the files in this order:
1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_functions.sql`
3. `supabase/migrations/0003_rls.sql`
4. `supabase/seed.sql` (sample services + discount codes)

**Option B — Supabase CLI:**
```bash
cd supabase
supabase link --project-ref <your-project-ref>
supabase db push
psql "$DATABASE_URL" -f seed.sql
```

### 4. Create the first admin

The schema doesn't auto-create staff — you bootstrap one:

1. Supabase Dashboard → **Authentication → Users → Add user** → enter your email and a password.
2. Copy the new user's UUID.
3. SQL Editor:
   ```sql
   insert into public.staff (auth_user_id, name, phone, role)
   values ('<user-uuid>', 'Owner Admin', '60123456789', 'admin');
   ```
4. Now sign in to the Expo app with that email/password — you'll have admin access to provision other staff.

### 5. Run the apps

See the per-app READMEs:
- [web/README.md](web/README.md)
- [app/README.md](app/README.md)

## Conventions

- **Money**: stored as `price_sen` (RM cents) integers — never floats. Display as `RM ${(price_sen/100).toFixed(2)}`.
- **Phone**: stored normalized (e.g. `60123456789`, no `+`, no spaces). The customer form accepts `0123456789` or `123456789` and normalizes.
- **Queue numbers**: reset per-barber at midnight. Unique on `(staff_id, queue_date, queue_number)`.
- **WhatsApp receipt**: opens `https://wa.me/<phone>?text=<receipt>` — staff taps **send** in their phone's WhatsApp.
