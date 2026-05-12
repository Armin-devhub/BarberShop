-- Staff mode is anonymous (no login). To send a WhatsApp receipt the dashboard
-- needs to read customer_phone. Grant the anon role SELECT on that column.
--
-- Trade-off: anyone with the anon API key (which is shipped to the customer
-- web client and therefore effectively public) can query phone numbers. For
-- a single-shop deployment where the shop tablet is the trust boundary, this
-- is acceptable. Re-tighten if the project grows.

grant select (customer_phone) on public.queue_entries to anon;
