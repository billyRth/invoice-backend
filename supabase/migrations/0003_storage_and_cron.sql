-- Ptas — buckets and the nightly sweep
--
-- Supabase-only: this one touches the `storage` and `cron` schemas, which a
-- plain Postgres does not have. supabase/tests/run.sh skips it for that reason;
-- everything it sets up is configuration, not a rule worth unit-testing.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Photos of a room are public information; that is the whole point of the app.
  ('listing-photos', 'listing-photos', true,  5242880,
   array['image/jpeg','image/png','image/webp']),
  -- The QR the landlord pays into. Public, and deliberately small.
  ('khqr',           'khqr',           true,  1048576,
   array['image/jpeg','image/png']),
  -- A bank receipt shows a real name and a real balance. Never public.
  ('payment-proofs', 'payment-proofs', false, 5242880,
   array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- Photos: anyone may look, only the listing's owner may put them there.
-- The first path segment is the listing id, which is what ties an object to
-- the row that authorises it.
create policy "listing photos are readable" on storage.objects for select
  to anon, authenticated using (bucket_id = 'listing-photos');

create policy "owners write their listing photos" on storage.objects for insert
  to authenticated with check (
    bucket_id = 'listing-photos'
    and exists (select 1 from public.listings l
                 where l.id::text = (storage.foldername(name))[1]
                   and l.owner_id = auth.uid()));

create policy "owners replace their listing photos" on storage.objects for update
  to authenticated using (
    bucket_id = 'listing-photos'
    and exists (select 1 from public.listings l
                 where l.id::text = (storage.foldername(name))[1]
                   and l.owner_id = auth.uid()));

create policy "owners delete their listing photos" on storage.objects for delete
  to authenticated using (
    bucket_id = 'listing-photos'
    and exists (select 1 from public.listings l
                 where l.id::text = (storage.foldername(name))[1]
                   and l.owner_id = auth.uid()));

create policy "khqr is readable" on storage.objects for select
  to anon, authenticated using (bucket_id = 'khqr');

-- Receipts: written by the payer under their own order, read by the payer and
-- by an admin. Never listed, never public, no delete.
create policy "payers write their own proof" on storage.objects for insert
  to authenticated with check (
    bucket_id = 'payment-proofs'
    and exists (select 1 from public.payment_orders o
                 where o.id::text = (storage.foldername(name))[1]
                   and o.created_by = auth.uid()));

create policy "payer or admin reads a proof" on storage.objects for select
  to authenticated using (
    bucket_id = 'payment-proofs'
    and exists (select 1 from public.payment_orders o
                 where o.id::text = (storage.foldername(name))[1]
                   and (o.created_by = auth.uid() or public.is_admin())));

-- --------------------------------------------------------------- the sweep
-- Once a night, anything whose month has run out stops being visible. This is
-- the only scheduled job in the system, and it is the one that makes the whole
-- freshness promise true rather than aspirational.

create extension if not exists pg_cron;

-- 18:17 UTC is 01:17 in Phnom Penh: nobody is looking, and a listing that
-- lapses overnight is gone before the morning search traffic.
select cron.schedule('expire-unpaid-listings', '17 18 * * *', $$select public.expire_unpaid()$$);
