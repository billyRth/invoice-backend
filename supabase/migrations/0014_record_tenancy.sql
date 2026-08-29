-- Ptas — join the tenant to the tenancy
--
-- The Currently Renting screen has existed since the prototype and has never
-- shown anything to an actual renter, because nothing ever set tenant_id. The
-- landlord types a name; the person who moved in has no way to be recognised.
--
-- Linking them needs a lookup by phone, and a client cannot do that: profiles
-- is readable only by its owner, deliberately, so that nobody can walk the
-- user table harvesting numbers. So the lookup happens here, inside a function
-- that returns a tenancy and never the profile it found.
--
-- A tenant with no account yet is still recorded, by name and number, with a
-- null tenant_id. That is the common case at first - the room is rented before
-- the renter has ever opened the app - and it must not be an error.

create or replace function record_tenancy(
  p_listing      uuid,
  p_tenant_name  text,
  p_tenant_phone text,
  p_starts_on    date,
  p_term_months  int,
  p_rent_usd     numeric,
  p_due_day      int default 1,
  p_deposit_usd  numeric default 0
) returns tenancies
language plpgsql security definer set search_path = public as $$
declare
  l  listings;
  t  tenancies;
  me uuid := require_uid();
  who uuid;
  v_phone text;
begin
  select * into l from listings where id = p_listing;
  if l.id is null then raise exception 'no such listing'; end if;
  if l.owner_id is distinct from me then raise exception 'not your listing'; end if;

  -- 012 345 678 and +85512345678 are the same person; store one shape so the
  -- renter is found whichever way the landlord typed it.
  v_phone := nullif(regexp_replace(coalesce(p_tenant_phone, ''), '[^0-9]', '', 'g'), '');
  if v_phone is not null then
    v_phone := '+855' || regexp_replace(
      case when v_phone like '855%' then substr(v_phone, 4) else v_phone end, '^0+', '');
    select id into who from profiles p where p.phone = v_phone;
  end if;

  -- A landlord cannot record themselves as their own tenant. It would be
  -- harmless but it would make the Renting screen show them their own room.
  if who = me then who := null; end if;

  insert into tenancies (listing_id, landlord_id, tenant_id, tenant_name, tenant_phone,
                         starts_on, term_months, rent_usd, due_day, deposit_usd)
  values (p_listing, me, who, coalesce(p_tenant_name, ''), coalesce(v_phone, ''),
          p_starts_on, p_term_months, p_rent_usd, p_due_day, p_deposit_usd)
  returning * into t;

  return t;
end $$;

grant execute on function record_tenancy(uuid, text, text, date, int, numeric, int, numeric)
  to authenticated;

-- Direct inserts are no longer the way in. The policy stays as defence in
-- depth, but the grant goes: an insert that skips this function is one that
-- silently loses the tenant link, which is exactly the bug being fixed.
revoke insert on tenancies from authenticated;
