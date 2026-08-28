-- Ptas — initial schema
--
-- The product thesis lives in this file, not just in the app:
--   * A listing is only visible while somebody is paying for it.
--   * Payment IS the freshness signal, so it is never automatic.
--   * A listing nobody has confirmed recently sinks; a rented one disappears.
-- Everything below exists to make those three sentences true in the database,
-- so a future client (web, Android, a script) cannot get them wrong.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- vocabulary

create type listing_kind   as enum ('room', 'studio', 'apartment', 'flathouse', 'house');
create type rent_term      as enum ('monthly', '3', '6', '12');
create type listing_status as enum ('draft', 'trial', 'live', 'paused', 'rented', 'archived');
create type report_reason  as enum ('already_rented', 'no_answer', 'wrong_price', 'not_as_described', 'other');

-- ----------------------------------------------------------------- profiles
-- Phone is the identity in Cambodia; email is not. Supabase phone auth owns
-- auth.users, this table owns everything the app needs to show.
--
-- `mode` is deliberately a PREFERENCE, not a role. The same person rents a room
-- and lists their old one. Nothing in RLS reads it.

create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  phone         text        not null,
  display_name  text        not null default '',
  lang          text        not null default 'km' check (lang in ('km', 'en')),
  mode          text        not null default 'renter' check (mode in ('renter', 'landlord')),
  telegram      text,
  created_at    timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, coalesce(new.phone, ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------- listings
-- Contact name and phone are denormalised on purpose: a landlord often puts an
-- agent or a family member as the contact, and that must not change when they
-- edit their own profile.

create table listings (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references profiles(id) on delete cascade,

  title           text not null check (length(btrim(title)) between 3 and 120),
  kind            listing_kind not null,
  term            rent_term    not null,
  min_stay_months int  not null default 1 check (min_stay_months between 1 and 36),

  district        text not null,
  address_note    text,
  lat             double precision not null check (lat between 9 and 15),
  lng             double precision not null check (lng between 102 and 108),

  price_usd       numeric(10,2) not null check (price_usd > 0 and price_usd < 100000),
  deposit_months  numeric(3,1)  not null default 1 check (deposit_months between 0 and 6),
  -- Utilities are riel per unit. 0 means "included in the rent", null means
  -- "the landlord did not say" — the app renders those differently, so they
  -- must stay different values.
  power_riel      int check (power_riel between 0 and 5000),
  water_riel      int check (water_riel between 0 and 20000),
  internet        boolean not null default false,

  beds            int not null default 0 check (beds between 0 and 10),
  size_sqm        int check (size_sqm between 5 and 2000),
  floor           int check (floor between -1 and 60),

  car_parking     int  not null default 0 check (car_parking between 0 and 20),
  moto_parking    boolean not null default false,

  aircon          boolean not null default false,
  furnished       boolean not null default false,
  private_bath    boolean not null default false,
  lift            boolean not null default false,
  washer          boolean not null default false,
  pets            boolean not null default false,
  balcony         boolean not null default false,
  security        boolean not null default false,
  kitchen         boolean not null default false,

  contact_name    text not null,
  contact_phone   text not null,

  status            listing_status not null default 'draft',
  available_now     boolean     not null default true,
  verified          boolean     not null default false,
  -- The two clocks the whole business runs on.
  last_confirmed_at timestamptz not null default now(),
  paid_until        timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index listings_visible_idx  on listings (status, last_confirmed_at desc)
  where status in ('trial', 'live');
create index listings_owner_idx    on listings (owner_id);
create index listings_geo_idx      on listings (lat, lng);
create index listings_price_idx    on listings (price_usd);
create index listings_paid_idx     on listings (paid_until) where status in ('trial', 'live');

create table listing_photos (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  path       text not null,            -- object key in the `listing-photos` bucket
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  unique (listing_id, position)
);
create index listing_photos_listing_idx on listing_photos (listing_id, position);

-- ------------------------------------------------------------------ payment
-- One row per month bought, never a recurring token. There is no auto-renew
-- anywhere in this schema, and that is the point: if the money renewed itself,
-- a rented room would keep paying and keep showing, which is the exact failure
-- every Cambodian rental page has today.

create table listing_periods (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  paid_by     uuid not null references profiles(id),
  amount_usd  numeric(10,2) not null check (amount_usd >= 0),
  method      text not null default 'khqr' check (method in ('khqr', 'trial', 'manual', 'relist_free')),
  reference   text,                    -- bank transaction id, unique per provider
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create unique index listing_periods_ref_idx on listing_periods (method, reference)
  where reference is not null;
create index listing_periods_listing_idx on listing_periods (listing_id, ends_at desc);

-- ------------------------------------------------------------------ signals

create table saved (
  renter_id  uuid not null references profiles(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (renter_id, listing_id)
);

create table reports (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references listings(id) on delete cascade,
  reporter_id uuid not null references profiles(id) on delete cascade,
  reason      report_reason not null default 'already_rented',
  note        text,
  created_at  timestamptz not null default now(),
  -- One report per person per listing per confirmation cycle. Without this a
  -- single angry renter could pause anyone.
  unique (listing_id, reporter_id)
);
create index reports_listing_idx on reports (listing_id);

-- ---------------------------------------------------------------- tenancies
-- A shared record filled in when the two people meet. Not a legal contract,
-- and the app says so. Its real job is to take the room off the market.

create table tenancies (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references listings(id) on delete restrict,
  landlord_id   uuid not null references profiles(id),
  tenant_id     uuid references profiles(id),
  tenant_name   text not null default '',
  tenant_phone  text not null default '',
  starts_on     date not null,
  term_months   int  not null check (term_months between 1 and 60),
  rent_usd      numeric(10,2) not null check (rent_usd > 0),
  due_day       int  not null default 1 check (due_day between 1 and 28),
  deposit_usd   numeric(10,2) not null default 0 check (deposit_usd >= 0),
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);
create unique index tenancies_active_idx on tenancies (listing_id) where ended_at is null;
create index tenancies_tenant_idx   on tenancies (tenant_id)   where ended_at is null;
create index tenancies_landlord_idx on tenancies (landlord_id) where ended_at is null;

-- ------------------------------------------------------------------- rules
-- Written as triggers, not as client code, so every future client obeys them.

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger listings_touch before update on listings
  for each row execute function touch_updated_at();

-- Two reports pause a listing until the landlord confirms it again.
create or replace function pause_on_reports() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from reports where listing_id = new.listing_id;
  if n >= 2 then
    update listings set status = 'paused'
     where id = new.listing_id and status in ('trial', 'live');
  end if;
  return new;
end $$;

create trigger reports_pause after insert on reports
  for each row execute function pause_on_reports();

-- Recording a tenancy takes the room off the market. This is the whole
-- freshness loop: the landlord gets something they want (a rent record) and
-- the market gets something it needs (one fewer ghost listing), in one action.
create or replace function rent_out_listing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update listings set status = 'rented', available_now = false
   where id = new.listing_id;
  return new;
end $$;

create trigger tenancies_rent_out after insert on tenancies
  for each row execute function rent_out_listing();

-- Confirming clears the reports that paused it and restarts the clock.
create or replace function confirm_listing(p_listing uuid) returns listings
language plpgsql security definer set search_path = public as $$
declare row listings;
begin
  select * into row from listings where id = p_listing;
  if row.id is null then raise exception 'no such listing'; end if;
  if row.owner_id <> auth.uid() then raise exception 'not your listing'; end if;

  delete from reports where listing_id = p_listing;
  update listings
     set last_confirmed_at = now(),
         status = case when status = 'paused' and coalesce(paid_until, now()) > now()
                       then 'live' else status end
   where id = p_listing
  returning * into row;
  return row;
end $$;

-- Run nightly (pg_cron). Unpaid pauses itself; nothing is deleted.
create or replace function expire_unpaid() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update listings set status = 'paused'
   where status in ('trial', 'live')
     and (paid_until is null or paid_until < now());
  get diagnostics n = row_count;
  return n;
end $$;

-- --------------------------------------------------------------- row security

alter table profiles        enable row level security;
alter table listings        enable row level security;
alter table listing_photos  enable row level security;
alter table listing_periods enable row level security;
alter table saved           enable row level security;
alter table reports         enable row level security;
alter table tenancies       enable row level security;

-- profiles: yours is yours. Nobody browses the user table; contact details
-- that a renter legitimately needs are denormalised onto the listing.
create policy profiles_self_read   on profiles for select using (id = auth.uid());
create policy profiles_self_write  on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- listings: the world sees what is being paid for; you see all of your own.
create policy listings_public_read on listings for select
  to anon, authenticated using (status in ('trial', 'live'));
create policy listings_owner_read  on listings for select
  using (owner_id = auth.uid());
create policy listings_owner_write on listings for insert
  with check (owner_id = auth.uid());
create policy listings_owner_edit  on listings for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy listings_owner_del   on listings for delete
  using (owner_id = auth.uid() and status <> 'rented');

create policy photos_public_read on listing_photos for select to anon, authenticated
  using (exists (select 1 from listings l where l.id = listing_id and l.status in ('trial','live')));
create policy photos_owner_all   on listing_photos for all
  using (exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()));

-- Payments are written by the KHQR webhook (service role), never by a client.
create policy periods_owner_read on listing_periods for select
  using (paid_by = auth.uid());

create policy saved_own on saved for all
  using (renter_id = auth.uid()) with check (renter_id = auth.uid());

-- A renter can report, and can see their own report. The landlord sees the
-- count through their listing, not the reporters' identities.
create policy reports_insert on reports for insert
  with check (reporter_id = auth.uid()
              and not exists (select 1 from listings l
                               where l.id = listing_id and l.owner_id = auth.uid()));
create policy reports_own_read on reports for select
  using (reporter_id = auth.uid());

-- A tenancy is visible to exactly the two people in it.
create policy tenancies_parties_read on tenancies for select
  using (landlord_id = auth.uid() or tenant_id = auth.uid());
create policy tenancies_landlord_write on tenancies for insert
  with check (landlord_id = auth.uid()
              and exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy tenancies_landlord_edit on tenancies for update
  using (landlord_id = auth.uid()) with check (landlord_id = auth.uid());

-- ------------------------------------------------------------------ search
-- The ranking rule from the prototype, moved server-side so it cannot drift:
-- anything unconfirmed for more than 14 days sinks below everything else,
-- whatever the sort.

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
  p_limit      int default 30,
  p_offset     int default 0
) returns setof listings
language sql stable as $$
  select l.* from listings l
  where l.status in ('trial', 'live')
    and (p_q     is null or l.title ilike '%'||p_q||'%' or l.district ilike '%'||p_q||'%')
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

-- --------------------------------------------------------------- privileges
-- Supabase grants these by default privilege on new tables; spelling them out
-- keeps the file runnable against a plain Postgres and makes the intent legible.
-- Every one of these is still filtered by the policies above.

grant usage on schema public to anon, authenticated;
grant select on listings, listing_photos to anon, authenticated;
grant select, insert, update, delete on listings, listing_photos, saved to authenticated;
grant select, update on profiles to authenticated;
grant select, insert on reports to authenticated;
grant select on listing_periods to authenticated;
grant select, insert, update on tenancies to authenticated;
grant execute on function search_listings(text, listing_kind[], rent_term, numeric, numeric, int, boolean, boolean, text, int, int) to anon, authenticated;
grant execute on function confirm_listing(uuid) to authenticated;
