-- Two report reasons weighted differently, saved searches, and the outbox.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP on

insert into auth.users (id, phone) values
  ('11111111-1111-1111-1111-111111111111','+855120000001'),   -- landlord
  ('22222222-2222-2222-2222-222222222222','+855120000002'),
  ('33333333-3333-3333-3333-333333333333','+855120000003'),
  ('44444444-4444-4444-4444-444444444444','+855120000004');
insert into profiles (id, phone) select id, phone from auth.users on conflict do nothing;

insert into listings (id, owner_id, title, kind, term, district, lat, lng, price_usd,
                      contact_name, contact_phone, status, paid_until)
values
 ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
  'Room A','room','monthly','toulkork',11.57,104.90,150,'Sok','012 1','live', now()+interval '20 days'),
 ('cccccccc-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
  'Room B','room','monthly','sensok',11.59,104.87,140,'Sok','012 1','live', now()+interval '20 days');

\echo == two people who were told it is rented pause it
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into reports (listing_id, reporter_id, reason)
  values ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','already_rented');
reset role; reset request.jwt.claim.sub;
select 'S1 after one: ' || status from listings where id='cccccccc-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
insert into reports (listing_id, reporter_id, reason)
  values ('cccccccc-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','already_rented');
reset role; reset request.jwt.claim.sub;
select 'S2 after two: ' || status from listings where id='cccccccc-0000-0000-0000-000000000001';
select 'S3 landlord told: ' || count(*) from notifications
  where kind='reported' and profile_id='11111111-1111-1111-1111-111111111111';

\echo == but two unanswered calls do not, because one busy line proves nothing
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into reports (listing_id, reporter_id, reason)
  values ('cccccccc-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','no_answer');
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
insert into reports (listing_id, reporter_id, reason)
  values ('cccccccc-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333','no_answer');
reset role; reset request.jwt.claim.sub;
select 'S4 after two no-answers: ' || status from listings where id='cccccccc-0000-0000-0000-000000000002';

\echo == three do
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
insert into reports (listing_id, reporter_id, reason)
  values ('cccccccc-0000-0000-0000-000000000002','44444444-4444-4444-4444-444444444444','no_answer');
reset role; reset request.jwt.claim.sub;
select 'S5 after three: ' || status from listings where id='cccccccc-0000-0000-0000-000000000002';

\echo == the same person can report both, once each
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into reports (listing_id, reporter_id, reason)
  values ('cccccccc-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','already_rented');
\set ON_ERROR_STOP off
insert into reports (listing_id, reporter_id, reason)
  values ('cccccccc-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','no_answer');
\set ON_ERROR_STOP on
reset role; reset request.jwt.claim.sub;

\echo == a saved search hears about a new room, and never about its own
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into saved_searches (renter_id, label, max_price, districts)
  values ('22222222-2222-2222-2222-222222222222','cheap in TK', 200, array['toulkork']);
reset role; reset request.jwt.claim.sub;

insert into listings (id, owner_id, title, kind, term, district, lat, lng, price_usd,
                      contact_name, contact_phone, status, paid_until)
values ('cccccccc-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
  'Room C','room','monthly','toulkork',11.57,104.90,180,'Sok','012 1','live', now()+interval '20 days');
select 'S6 watcher told: ' || count(*) from notifications
  where kind='search_match' and profile_id='22222222-2222-2222-2222-222222222222';

-- too expensive, and in the wrong district
insert into listings (id, owner_id, title, kind, term, district, lat, lng, price_usd,
                      contact_name, contact_phone, status, paid_until)
values ('cccccccc-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
  'Room D','room','monthly','toulkork',11.57,104.90,900,'Sok','012 1','live', now()+interval '20 days'),
       ('cccccccc-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
  'Room E','room','monthly','chbarampov',11.53,104.95,120,'Sok','012 1','live', now()+interval '20 days');
select 'S7 still only one match: ' || count(*) from notifications where kind='search_match';

-- a draft nobody has paid for is not news
insert into listings (id, owner_id, title, kind, term, district, lat, lng, price_usd,
                      contact_name, contact_phone)
values ('cccccccc-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111',
  'Room F','room','monthly','toulkork',11.57,104.90,160,'Sok','012 1');
select 'S8 drafts are not news: ' || count(*) from notifications where kind='search_match';

-- and paying for it is
update listings set status='live', paid_until=now()+interval '30 days'
 where id='cccccccc-0000-0000-0000-000000000006';
select 'S9 paying for it is: ' || count(*) from notifications where kind='search_match';

-- a listing that pauses and comes back is not news twice
update listings set status='paused' where id='cccccccc-0000-0000-0000-000000000006';
update listings set status='live'   where id='cccccccc-0000-0000-0000-000000000006';
select 'S10 not news twice: ' || count(*) from notifications where kind='search_match';

\echo == a landlord is warned before the month runs out, once
update listings set paid_until = now() + interval '2 days' where id='cccccccc-0000-0000-0000-000000000003';
select 'S11 warned: ' || warn_expiring();
select 'S12 warned again (should be 0): ' || warn_expiring();
select 'S13 messages queued: ' || count(*) from notifications where kind='expiring';

\echo == saved searches are private to the renter who made them
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select 'S14 stranger sees searches: ' || count(*) from saved_searches;
reset role; reset request.jwt.claim.sub;

\echo == a function added later cannot be reached without saying so
create function public.something_added_later() returns int language sql as $$ select 1 $$;
select 'S15 anon can call it: ' ||
  has_function_privilege('anon','something_added_later()','execute')::text;
select 'S16 signed-in can call it: ' ||
  has_function_privilege('authenticated','something_added_later()','execute')::text;
select 'S17 but browsing is still open: ' ||
  has_function_privilege('anon',
    'search_listings(text, listing_kind[], rent_term, numeric, numeric, int, boolean, boolean, text, text[], int, int)',
    'execute')::text;
select 'S18 and the outbox is not: ' ||
  has_function_privilege('authenticated','enqueue(uuid,text,jsonb,text)','execute')::text;

\echo == a tenancy finds the tenant by phone, and both parties can see it
insert into listings (id, owner_id, title, kind, term, district, lat, lng, price_usd,
                      contact_name, contact_phone, status, paid_until)
values ('cccccccc-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111',
  'Room to rent out','room','monthly','toulkork',11.57,104.90,200,'Sok','012 1','live', now()+interval '20 days');

set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
-- typed the way a landlord would, with a leading zero and spaces
select 'S19 tenant matched: ' ||
  ((record_tenancy('cccccccc-0000-0000-0000-00000000000a', 'Dara', '012 000 0002',
                   current_date, 12, 200, 1, 200)).tenant_id
   = '22222222-2222-2222-2222-222222222222')::text;
reset role; reset request.jwt.claim.sub;

select 'S20 the room left the market: ' || status
  from listings where id='cccccccc-0000-0000-0000-00000000000a';

set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'S21 the tenant can see it: ' || count(*) from tenancies
  where listing_id='cccccccc-0000-0000-0000-00000000000a';
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select 'S22 a stranger cannot: ' || count(*) from tenancies
  where listing_id='cccccccc-0000-0000-0000-00000000000a';
reset role; reset request.jwt.claim.sub;

\echo == an unknown number is recorded rather than refused
insert into listings (id, owner_id, title, kind, term, district, lat, lng, price_usd,
                      contact_name, contact_phone, status, paid_until)
values ('cccccccc-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111',
  'Another room','room','monthly','sensok',11.59,104.87,150,'Sok','012 1','live', now()+interval '20 days');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'S23 no account yet, still recorded: ' ||
  ((record_tenancy('cccccccc-0000-0000-0000-00000000000b', 'Sokha', '098 765 432',
                   current_date, 6, 150)).tenant_id is null)::text;
reset role; reset request.jwt.claim.sub;
select 'S24 direct insert revoked: ' ||
  (not has_table_privilege('authenticated','tenancies','insert'))::text;

\echo == and can still see the room itself, which left the market when they moved in
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'S25 tenant sees their room: ' || count(*) from listings
  where id='cccccccc-0000-0000-0000-00000000000a';
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select 'S26 a stranger still cannot: ' || count(*) from listings
  where id='cccccccc-0000-0000-0000-00000000000a';
reset role; reset request.jwt.claim.sub;
