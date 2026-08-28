-- Ptas — demo data
--
-- The eleven listings from the prototype, as real rows: real Phnom Penh
-- coordinates, prices typical of 2026, and a spread of states that exercises
-- every rule — one stale, one paused for non-payment, one on trial, one live
-- and freshly confirmed.
--
-- Titles are in Khmer because that is what a Cambodian landlord types. The
-- app translates the interface and the district names; it does not translate
-- what a person wrote.
--
-- Safe to re-run: it deletes only the rows it created.

delete from listings where owner_id in (select id from profiles where phone like '+85510000%');
delete from auth.users where phone like '+85510000%';

insert into auth.users (id, phone) values
  ('a0000000-0000-4000-8000-000000000001', '+855100001'),
  ('a0000000-0000-4000-8000-000000000002', '+855100002'),
  ('a0000000-0000-4000-8000-000000000003', '+855100003'),
  ('a0000000-0000-4000-8000-000000000004', '+855100004'),
  ('a0000000-0000-4000-8000-000000000005', '+855100005');

update profiles set display_name = v.n from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'Chan Sophal'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'Meas Dara'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'Ly Sreyneang'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'Pen Chanthou'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'Tep Marina')
) as v(id, n) where profiles.id = v.id;

insert into listings (owner_id, title, kind, term, min_stay_months, district, address_note,
  lat, lng, price_usd, deposit_months, power_riel, water_riel, internet,
  beds, size_sqm, floor, car_parking, moto_parking,
  aircon, furnished, private_bath, lift, washer, pets, balcony, security, kitchen,
  contact_name, contact_phone, status, available_now, verified,
  last_confirmed_at, paid_until)
values
 ('a0000000-0000-4000-8000-000000000001','បន្ទប់ស្ទូឌីយោ ជិតផ្សារទួលគោក','studio','monthly',3,'toulkork','ជិតផ្សារទួលគោក',
  11.5760,104.8905,180,1,1000,0,true, 0,28,2, 0,true,
  true,true,true,false,false,false,false,true,true,
  'Chan Sophal','012 509 650','live',true,true, now() - interval '1 day', now() + interval '23 days'),

 ('a0000000-0000-4000-8000-000000000002','អាផាតមិន ១បន្ទប់ មានយ៉រ បឹងកេងកង៣','apartment','12',12,'boengkengkang','បឹងកេងកង៣',
  11.5450,104.9185,320,2,900,2500,true, 1,45,4, 1,true,
  true,true,true,true,true,false,true,true,true,
  'Meas Dara','012 622 921','live',true,true, now() - interval '3 days', now() + interval '11 days'),

 ('a0000000-0000-4000-8000-000000000003','ផ្ទះល្វែង ២បន្ទប់ សែនសុខ','flathouse','6',6,'sensok','ជិតផ្សារសែនសុខ',
  11.5950,104.8720,250,1,800,0,false, 2,60,0, 1,true,
  false,false,true,false,false,true,false,false,true,
  'Ly Sreyneang','012 525 799','live',true,false, now() - interval '2 days', now() + interval '6 days'),

 ('a0000000-0000-4000-8000-000000000004','បន្ទប់ជួល ខាងលើហាងកាហ្វេ ផ្សារទួលទំពូង','room','monthly',1,'boengkengkang','ទួលទំពូង ក្បែរផ្សាររុស្ស៊ី',
  11.5430,104.9210,140,1,1200,3000,true, 0,22,3, 0,true,
  true,true,false,false,false,false,false,false,false,
  'Kim Bunthoeun','012 988 445','live',true,true, now() - interval '6 days', now() + interval '15 days'),

 ('a0000000-0000-4000-8000-000000000004','ផ្ទះមាត់ទន្លេ ជ្រោយចង្វារ','house','12',12,'chroychangvar','មាត់ទន្លេ',
  11.5880,104.9350,450,2,730,2000,false, 3,110,0, 2,true,
  false,false,true,false,true,true,true,false,true,
  'Pen Chanthou','012 663 803','live',false,true, now() - interval '4 days', now() + interval '19 days'),

 -- The neglected one. Nineteen days without a word, so it sinks below
 -- everything else however the renter sorts.
 ('a0000000-0000-4000-8000-000000000005','បន្ទប់ជួលថោក ច្បារអំពៅ','room','monthly',1,'chbarampov','ក្បែរស្ពានមុនីវង្ស',
  11.5300,104.9500,95,1,1500,4000,false, 0,18,1, 0,true,
  false,false,false,false,false,false,false,false,false,
  'Sok Vanna','012 638 938','live',true,false, now() - interval '19 days', now() + interval '4 days'),

 ('a0000000-0000-4000-8000-000000000001','អាផាតមិន ២បន្ទប់ ជិតវិទ្យាស្ថានបច្ចេកវិទ្យា','apartment','6',6,'toulkork','ជិតវិទ្យាស្ថានបច្ចេកវិទ្យាកម្ពុជា',
  11.5795,104.8860,280,1,730,0,true, 2,55,5, 1,true,
  true,true,true,true,true,false,true,true,true,
  'Nou Sokhem','012 839 330','live',true,true, now() - interval '2 hours', now() + interval '23 days'),

 ('a0000000-0000-4000-8000-000000000005','អាផាតមិនសេវាកម្ម ១បន្ទប់ បឹងកេងកង១','apartment','12',12,'boengkengkang','បឹងកេងកង១',
  11.5490,104.9230,520,2,0,0,true, 1,50,8, 1,true,
  true,true,true,true,true,false,false,true,true,
  'Tep Marina','012 916 102','live',true,true, now() - interval '8 days', now() + interval '27 days'),

 -- Stopped paying. Invisible to renters; still on its owner's own list, with
 -- one tap to bring it back.
 ('a0000000-0000-4000-8000-000000000003','ផ្ទះល្វែងជាន់ផ្ទាល់ដី ទួលសង្កែ','flathouse','monthly',3,'russeykeo','ទួលសង្កែ',
  11.6050,104.9020,210,1,850,2500,false, 1,40,0, 1,true,
  false,false,true,false,false,true,false,false,true,
  'Hun Sreypov','012 103 065','paused',true,false, now() - interval '11 days', now() - interval '2 days'),

 -- In its free fortnight.
 ('a0000000-0000-4000-8000-000000000002','បន្ទប់និស្សិត មានចំណតម៉ូតូ សែនសុខ','room','monthly',1,'sensok','ក្បែរសាកលវិទ្យាល័យ',
  11.5990,104.8680,120,1,900,0,true, 0,20,2, 0,true,
  true,true,true,false,false,false,false,true,false,
  'Chea Vichea','012 479 442','trial',true,true, now() - interval '2 days', now() + interval '9 days'),

 ('a0000000-0000-4000-8000-000000000004','វីឡា មានសួន បឹងកេងកង២','house','12',12,'boengkengkang','បឹងកេងកង២',
  11.5470,104.9160,900,2,730,2000,true, 4,180,0, 2,true,
  true,true,true,false,true,true,true,true,true,
  'Ouk Sovannara','012 740 961','live',false,true, now() - interval '5 days', now() + interval '30 days');
