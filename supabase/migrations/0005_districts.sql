-- Ptas — districts as a vocabulary, not free text
--
-- Two different things were both called "district" in the prototype:
--
--   * The khan (ខណ្ឌ), of which Phnom Penh has exactly fourteen. This is a
--     closed list, it is what people filter by, and it is the one thing on a
--     listing that genuinely needs both languages — the app can translate a
--     code, it cannot translate what a landlord typed.
--   * The bit people actually say out loud: "behind Russian Market", "near
--     the Institute of Technology". That is free text and always will be.
--
-- So the khan becomes a foreign key and the landmark stays in address_note.
-- Note what is NOT translated here: the listing title. A landlord writes it
-- once, in their own language, and that is what renters should see. Storing
-- en/km pairs for user-written text only ever produces one filled field and
-- one empty one.

create table districts (
  code     text primary key,
  name_km  text not null,
  name_en  text not null,
  position int  not null
);

insert into districts (code, name_km, name_en, position) values
  ('chamkarmon',    'ចំការមន',        'Chamkar Mon',      1),
  ('daunpenh',      'ដូនពេញ',         'Doun Penh',        2),
  ('prampirmakara', 'ប្រាំពីរមករា',    '7 Makara',         3),
  ('toulkork',      'ទួលគោក',         'Toul Kork',        4),
  ('dangkao',       'ដង្កោ',          'Dangkao',          5),
  ('meanchey',      'មានជ័យ',         'Mean Chey',        6),
  ('russeykeo',     'ឫស្សីកែវ',        'Russey Keo',       7),
  ('sensok',        'សែនសុខ',         'Sen Sok',          8),
  ('pousenchey',    'ពោធិ៍សែនជ័យ',    'Pou Senchey',      9),
  ('chroychangvar', 'ជ្រោយចង្វារ',     'Chroy Changvar',  10),
  ('prekpnov',      'ព្រែកព្នៅ',       'Prek Pnov',       11),
  ('chbarampov',    'ច្បារអំពៅ',       'Chbar Ampov',     12),
  ('boengkengkang', 'បឹងកេងកង',       'Boeng Keng Kang', 13),
  ('kamboul',       'កំបូល',          'Kamboul',         14);

-- No rows exist yet, so this is a straight swap rather than a backfill.
alter table listings
  alter column district type text,
  add constraint listings_district_fk foreign key (district) references districts(code);

create index listings_district_idx on listings (district);

alter table districts enable row level security;
create policy districts_read on districts for select to anon, authenticated using (true);
grant select on districts to anon, authenticated;

-- Search gains a district filter, and matches the free-text query against the
-- district name in BOTH languages, so typing "Toul Kork" or "ទួលគោក" works
-- whichever way the app is set.
create or replace function search_listings(
  p_q          text default null,
  p_kinds      listing_kind[] default null,
  p_term       rent_term default null,
  p_min        numeric default null,
  p_max        numeric default null,
  p_beds       int default null,
  p_car        boolean default false,
  p_moto       boolean default false,
  p_sort       text default 'best',
  p_districts  text[] default null,
  p_limit      int default 30,
  p_offset     int default 0
) returns setof listings
language sql stable set search_path = public as $$
  select l.* from listings l
  join districts d on d.code = l.district
  where l.status in ('trial', 'live')
    and (p_q is null or l.title ilike '%'||p_q||'%'
                     or l.address_note ilike '%'||p_q||'%'
                     or d.name_en ilike '%'||p_q||'%'
                     or d.name_km like '%'||p_q||'%')
    and (p_districts is null or l.district = any(p_districts))
    and (p_kinds is null or l.kind = any(p_kinds))
    and (p_term  is null or l.term = p_term)
    and (p_min   is null or l.price_usd >= p_min)
    and (p_max   is null or l.price_usd <= p_max)
    and (p_beds  is null or l.beds >= p_beds)
    and (not p_car  or l.car_parking > 0)
    and (not p_moto or l.moto_parking)
  order by
    (l.last_confirmed_at < now() - interval '14 days'),
    case when p_sort = 'low'  then l.price_usd end asc,
    case when p_sort = 'high' then l.price_usd end desc,
    l.last_confirmed_at desc
  limit greatest(1, least(p_limit, 60)) offset greatest(0, p_offset);
$$;

-- The signature changed, so the old one is a different function and would
-- otherwise linger, ungranted but present.
drop function if exists search_listings(text, listing_kind[], rent_term, numeric, numeric,
                                        int, boolean, boolean, text, int, int);

grant execute on function search_listings(text, listing_kind[], rent_term, numeric, numeric,
                                          int, boolean, boolean, text, text[], int, int)
  to anon, authenticated;
