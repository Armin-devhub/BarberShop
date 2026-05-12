# BarberShop — Customer Web

The Next.js site customers land on after scanning the in-shop QR code.

## Setup

```bash
cd web
npm install
cp .env.example .env.local      # then fill in your Supabase URL + anon key
npm run dev
```

Open http://localhost:3000.

## Customer flow

1. **`/`** — enter name + phone (saved to localStorage so a refresh doesn't lose it).
2. **`/barbers`** — barbers currently on shift, with live "X people ahead" counts (Supabase Realtime).
3. **`/barbers/[shiftId]`** — pick a service, optionally apply a discount code, see final price, join the queue.
4. **`/queue/[entryId]`** — live position in the queue, updates as the barber advances customers.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Vercel → New Project → import the repo → set Root Directory to `web`.
3. Add the same two env vars from `.env.local` in Vercel project settings.
4. Generate a QR code that points to the production URL → print and put it in the shop.

## Notes

- All data fetching is client-side (anonymous Supabase access). RLS on the database protects sensitive columns.
- Phone numbers are normalized to Malaysian format (`60xxxxxxxxx`) when sent to the queue RPC.
- Realtime subscriptions are cleaned up on unmount via `supabase.removeChannel`.
