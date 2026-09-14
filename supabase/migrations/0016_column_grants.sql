-- Pteas — the columns a person may write are not the columns they may read
--
-- Row-level security answers "which rows"; it says nothing about "which
-- columns". listings_owner_edit let an owner update THEIR row, and every
-- column of it: a single PATCH {status:'live', paid_until:'2099-01-01',
-- verified:true, last_confirmed_at:now()} made a listing visible forever
-- without paying, badged as ID-checked without a check, and immune to the
-- nightly sweep. Every rule the README says the database enforces by itself
-- was one request away from being decoration. The same shape let a landlord
-- re-point a tenancy at any user or any listing, and let anyone rewrite their
-- own phone number to hijack the lookup that links a tenancy to its tenant.
--
-- Postgres grants can be per column. So the table-wide INSERT/UPDATE grants
-- go, and come back listing exactly the columns a landlord legitimately types.
-- Everything the business logic owns - status, paid_until, verified,
-- last_confirmed_at - is reachable only through the functions that own it.
--
-- SELECT stays table-wide on purpose: PostgREST's select=* fails outright if
-- any column is unreadable, and hiding owner_id would need a view. owner_id is
-- a uuid, not a phone number, and with tenant_id locked below it opens nothing.

-- ------------------------------------------------------------------ listings
revoke insert, update on listings from authenticated;

grant insert (owner_id, title, kind, term, min_stay_months, district, address_note,
              lat, lng, location_exact, price_usd, deposit_months, power_riel, water_riel,
              internet, beds, size_sqm, floor, car_parking, moto_parking,
              aircon, furnished, private_bath, lift, washer, pets, balcony, security, kitchen,
              contact_name, contact_phone, available_now)
  on listings to authenticated;

grant update (title, kind, term, min_stay_months, district, address_note,
              lat, lng, location_exact, price_usd, deposit_months, power_riel, water_riel,
              internet, beds, size_sqm, floor, car_parking, moto_parking,
              aircon, furnished, private_bath, lift, washer, pets, balcony, security, kitchen,
              contact_name, contact_phone, available_now)
  on listings to authenticated;

-- The one status change a landlord makes by hand - "it's gone" - was a raw
-- PATCH of status. That column is no longer theirs, so it becomes a function
-- with the rule inside it: only off the market, never back on.
create or replace function mark_rented(p_listing uuid) returns listings
language plpgsql security definer set search_path = public as $$
declare
  l  listings;
  me uuid := require_uid();
begin
  select * into l from listings where id = p_listing;
  if l.id is null then raise exception 'no such listing'; end if;
  if l.owner_id is distinct from me then raise exception 'not your listing'; end if;
  update listings set status = 'rented', available_now = false
   where id = p_listing returning * into l;
  return l;
end $$;
grant execute on function mark_rented(uuid) to authenticated;

-- The approvals queue reads listings(title, contact_phone) beside each order.
-- An unpaid listing is a draft, drafts are visible only to their owner, and
-- the admin is not the owner - so the queue showed "—" for every title. An
-- admin may read any listing; they can already read every receipt.
create policy listings_admin_read on listings for select
  to authenticated using (is_admin());

-- ----------------------------------------------------------------- tenancies
-- A landlord may end one, or correct the money on it. They may not move it to
-- another person or another room after the fact.
revoke insert, update on tenancies from authenticated;
grant update (ended_at, due_day, rent_usd, deposit_usd) on tenancies to authenticated;

-- ------------------------------------------------------------------ profiles
-- phone is identity and telegram_chat_id is where messages go. Neither is the
-- user's to edit from a client: phone comes from sign-in (set by the signup
-- trigger or the dev-signin function under the service role), the chat id
-- from the Telegram webhook, the token from its default.
revoke update on profiles from authenticated;
grant update (display_name, lang, mode) on profiles to authenticated;

-- With phone unwritable by clients, one number is one person. The lookup that
-- links a tenancy to its tenant must not depend on which duplicate came first.
create unique index profiles_phone_unique on profiles (phone) where phone <> '';

-- ------------------------------------------------------------------ security
-- The event trigger from 0011 already stripped anon/authenticated from
-- mark_rented() on creation; the grant above is the deliberate exception.
