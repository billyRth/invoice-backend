\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- two people
insert into auth.users (id, phone) values
  ('11111111-1111-1111-1111-111111111111','+855120000001'),  -- landlord
  ('22222222-2222-2222-2222-222222222222','+855120000002'),  -- renter A
  ('33333333-3333-3333-3333-333333333333','+855120000003');  -- renter B

insert into listings (id, owner_id, title, kind, term, district, lat, lng, price_usd,
                      contact_name, contact_phone, status, paid_until, last_confirmed_at)
values
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Fresh room','room','monthly','toulkork',11.57,104.90,150,'Sok','012 000 001','live', now()+interval '20 days', now()),
 ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','Stale cheap room','room','monthly','toulkork',11.57,104.90,90,'Sok','012 000 001','live', now()+interval '20 days', now()-interval '30 days'),
 ('aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','Draft','room','monthly','toulkork',11.57,104.90,100,'Sok','012 000 001','draft', null, now());

insert into profiles (id, phone) select id, phone from auth.users on conflict do nothing;

-- 1. stale sinks even when sorting by price
select 'T1 stale-sinks: ' || string_agg(title, ' | ' order by ord)
from (select title, row_number() over () ord from search_listings(p_sort=>'low')) t;

-- 1b. the district filter, and the query matching a district name in Khmer
select 'T1b by-district: ' || count(*) from search_listings(p_districts=>array['toulkork']);
select 'T1c wrong-district: ' || count(*) from search_listings(p_districts=>array['sensok']);
select 'T1d khmer-query: ' || count(*) from search_listings(p_q=>'ទួលគោក');

-- 2. anon only sees paid listings (draft hidden)
set role anon;
select 'T2 anon-sees: ' || count(*) from listings;
reset role;

-- 3. two reports pause it; one does not
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into reports (listing_id, reporter_id) values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
reset role; reset request.jwt.claim.sub;
select 'T3a after-one-report: ' || status from listings where id='aaaaaaaa-0000-0000-0000-000000000001';

set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
insert into reports (listing_id, reporter_id) values ('aaaaaaaa-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333');
reset role; reset request.jwt.claim.sub;
select 'T3b after-two-reports: ' || status from listings where id='aaaaaaaa-0000-0000-0000-000000000001';

-- 4. landlord confirms: back to live, reports cleared
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'T4 after-confirm: ' || (confirm_listing('aaaaaaaa-0000-0000-0000-000000000001')).status;
reset role; reset request.jwt.claim.sub;
select 'T4b reports-left: ' || count(*) from reports where listing_id='aaaaaaaa-0000-0000-0000-000000000001';

-- 5. a renter cannot confirm someone else's listing
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  perform confirm_listing('aaaaaaaa-0000-0000-0000-000000000001');
  raise notice 'T5 FAIL: renter confirmed a listing they do not own';
exception when others then raise notice 'T5 blocked: %', sqlerrm; end $$;

-- 6. a renter cannot edit someone else's listing
update listings set price_usd = 1 where id='aaaaaaaa-0000-0000-0000-000000000001';
reset role; reset request.jwt.claim.sub;
select 'T6 price-after-attack: ' || price_usd from listings where id='aaaaaaaa-0000-0000-0000-000000000001';

-- 7. recording a tenancy takes the room off the market
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into tenancies (listing_id, landlord_id, tenant_id, starts_on, term_months, rent_usd)
values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222', current_date, 12, 150);
reset role; reset request.jwt.claim.sub;
select 'T7 after-tenancy: ' || status from listings where id='aaaaaaaa-0000-0000-0000-000000000001';

-- 8. the tenancy is visible to both parties and to nobody else
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'T8a tenant-sees: ' || count(*) from tenancies;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select 'T8b stranger-sees: ' || count(*) from tenancies;
reset role; reset request.jwt.claim.sub;

-- 9. unpaid pauses itself
update listings set paid_until = now() - interval '1 day' where id='aaaaaaaa-0000-0000-0000-000000000002';
select 'T9 expired: ' || expire_unpaid();
select 'T9b status: ' || status from listings where id='aaaaaaaa-0000-0000-0000-000000000002';

-- 10. one active tenancy per listing
do $$ begin
  insert into tenancies (listing_id, landlord_id, starts_on, term_months, rent_usd)
  values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', current_date, 12, 150);
  raise notice 'T10 FAIL: double-booked a listing';
exception when unique_violation then raise notice 'T10 blocked: double booking'; end $$;

-- 11. a landlord cannot report themselves clean/dirty
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  insert into reports (listing_id, reporter_id) values ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111');
  raise notice 'T11 FAIL: landlord reported their own listing';
exception when others then raise notice 'T11 blocked: %', sqlerrm; end $$;
reset role; reset request.jwt.claim.sub;
