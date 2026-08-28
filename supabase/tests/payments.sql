-- The $1 flow, end to end, with the four ways someone would try to cheat it.
--
-- Note on the negative tests: psql does not interpolate :variables inside a
-- $$ ... $$ block, so an expected failure is written as a plain call with
-- ON_ERROR_STOP turned off. The printed ERROR line is the assertion.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

insert into auth.users (id, phone) values
  ('11111111-1111-1111-1111-111111111111','+855120000001'),   -- landlord
  ('22222222-2222-2222-2222-222222222222','+855120000002'),   -- a renter
  ('99999999-9999-9999-9999-999999999999','+855120000009');   -- admin
insert into profiles (id, phone) select id, phone from auth.users on conflict do nothing;
insert into admins (profile_id) values ('99999999-9999-9999-9999-999999999999');
insert into receiving_accounts (version, display_name, qr_path, is_active, activated_at)
  values (1, 'PTAS / SOK DARA', 'khqr/v1.png', true, now());

insert into listings (id, owner_id, title, kind, term, district, lat, lng, price_usd, contact_name, contact_phone)
values
 ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Room near Toul Kork','room','monthly','toulkork',11.57,104.90,150,'Sok','012 000 001'),
 ('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Second room','room','monthly','toulkork',11.57,104.90,160,'Sok','012 000 001');

\echo == a draft is invisible
set role anon; select 'P1 anon-sees: ' || count(*) from listings; reset role;

\echo == the free fortnight, once per landlord ever
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'P2 after-trial: ' || (start_trial('bbbbbbbb-0000-0000-0000-000000000001')).status;
\set ON_ERROR_STOP off
select 'P3 FAIL second trial: ' || (start_trial('bbbbbbbb-0000-0000-0000-000000000002')).status;
\set ON_ERROR_STOP on

\echo == one open order per listing, never two
select 'P4 order-state: ' || (start_payment('bbbbbbbb-0000-0000-0000-000000000001', 1)).state;
select 'P5 same-code-twice: ' ||
  ((start_payment('bbbbbbbb-0000-0000-0000-000000000001',1)).order_code =
   (select order_code from payment_orders order by created_at limit 1))::text;
reset role; reset request.jwt.claim.sub;
select 'P5b open-orders: ' || count(*) from payment_orders;

select id as ord from payment_orders limit 1;
\gset

\echo == a stranger cannot attach a receipt to your order
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\set ON_ERROR_STOP off
select 'P6 FAIL stranger proof: ' || (submit_proof(:'ord', 'proofs/hack.jpg')).state;
select 'P7 FAIL non-admin approve: ' || (approve_payment_order(:'ord')).status;
\set ON_ERROR_STOP on
select 'P7b stranger-sees-orders: ' || count(*) from payment_orders;
reset role; reset request.jwt.claim.sub;

\echo == the owner uploads the receipt
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'P8 after-proof: ' || (submit_proof(:'ord', 'proofs/ok.jpg', 'ABA123')).state;
reset role; reset request.jwt.claim.sub;

-- Make the listing look neglected and reported, so approval has work to do.
update listings set last_confirmed_at = now() - interval '40 days' where id='bbbbbbbb-0000-0000-0000-000000000001';
insert into reports (listing_id, reporter_id) values ('bbbbbbbb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');

\echo == admin approves: live, paid a month further out, freshly confirmed
set role authenticated; set request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
select 'P9 status: ' || (approve_payment_order(:'ord', 'ABA123')).status;
select 'P10 double-tap: ' || (approve_payment_order(:'ord')).status;
reset role; reset request.jwt.claim.sub;

-- Counted outside any role: periods_owner_read only shows a payer their own
-- payments, so counting these as the admin would report 0 whatever happened.
select 'P9b months-sold: ' || count(*) from listing_periods where method='khqr';
select 'P9c paid-ahead-days: ' || round(extract(epoch from (paid_until - now()))/86400)
  from listings where id='bbbbbbbb-0000-0000-0000-000000000001';
select 'P9d confirmed-mins-ago: ' || round(extract(epoch from (now() - last_confirmed_at))/60)
  from listings where id='bbbbbbbb-0000-0000-0000-000000000001';
select 'P9e reports-left: ' || count(*) from reports where listing_id='bbbbbbbb-0000-0000-0000-000000000001';

\echo == when the month runs out the listing pauses itself
update listings set paid_until = now() - interval '1 hour' where id='bbbbbbbb-0000-0000-0000-000000000001';
select 'P11 expired: ' || expire_unpaid();
set role anon; select 'P11b anon-sees: ' || count(*) from listings; reset role;
