-- Ptas — an ownership check that fires when there is no owner to check against
--
-- Every one of these functions guarded itself with
--
--     if l.owner_id <> auth.uid() then raise exception 'not your listing';
--
-- which does the right thing for the wrong caller and the WRONG thing for no
-- caller at all: `uuid <> NULL` is NULL, not true, so the branch is skipped and
-- execution continues as though the check had passed.
--
-- With auth.uid() null, confirm_listing() would therefore have reset any
-- listing's freshness clock and cleared its reports - which is not a small
-- bug, because that clock is the entire product. start_payment() only escaped
-- because payment_orders.created_by is NOT NULL and the insert failed; that is
-- luck, not a check.
--
-- Nothing was reachable in practice: 0004 revoked EXECUTE from anon, so an
-- unauthenticated request cannot get this far. That is exactly why it is worth
-- fixing rather than shrugging at - the outer lock held while the inner one
-- was open, and only one of them is visible in the function's own text.
--
-- Found because the test fixture shared one Postgres connection between
-- concurrent requests, which corrupted the transaction-local JWT claim and
-- produced a null uid by accident.

create or replace function require_uid() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid;
begin
  u := auth.uid();
  if u is null then raise exception 'not signed in'; end if;
  return u;
end $$;

create or replace function confirm_listing(p_listing uuid) returns listings
language plpgsql security definer set search_path = public as $$
declare
  row listings;
  me  uuid := require_uid();
begin
  select * into row from listings where id = p_listing;
  if row.id is null then raise exception 'no such listing'; end if;
  if row.owner_id is distinct from me then raise exception 'not your listing'; end if;

  delete from reports where listing_id = p_listing;
  update listings
     set last_confirmed_at = now(),
         status = case when status = 'paused' and coalesce(paid_until, now()) > now()
                       then 'live' else status end
   where id = p_listing
  returning * into row;
  return row;
end $$;

create or replace function start_trial(p_listing uuid) returns listings
language plpgsql security definer set search_path = public as $$
declare
  l  listings;
  me uuid := require_uid();
begin
  select * into l from listings where id = p_listing;
  if l.id is null then raise exception 'no such listing'; end if;
  if l.owner_id is distinct from me then raise exception 'not your listing'; end if;
  if exists (select 1 from listing_periods p
              join listings x on x.id = p.listing_id
             where x.owner_id = l.owner_id and p.method = 'trial') then
    raise exception 'trial already used';
  end if;

  insert into listing_periods (listing_id, paid_by, amount_usd, method, starts_at, ends_at)
  values (p_listing, l.owner_id, 0, 'trial', now(), now() + interval '14 days');

  update listings set status = 'trial', paid_until = now() + interval '14 days',
                      last_confirmed_at = now()
   where id = p_listing returning * into l;
  return l;
end $$;

create or replace function start_payment(p_listing uuid, p_months int default 1)
returns payment_orders
language plpgsql security definer set search_path = public as $$
declare
  l    listings;
  acct receiving_accounts;
  o    payment_orders;
  code text;
  tries int := 0;
  me   uuid := require_uid();
begin
  select * into l from listings where id = p_listing;
  if l.id is null then raise exception 'no such listing'; end if;
  if l.owner_id is distinct from me then raise exception 'not your listing'; end if;
  if p_months < 1 or p_months > 12 then raise exception 'months out of range'; end if;

  update payment_orders set state = 'expired'
   where listing_id = p_listing and state = 'awaiting_proof' and expires_at < now();
  if exists (select 1 from payment_orders
              where listing_id = p_listing and state in ('awaiting_proof','submitted')) then
    select * into o from payment_orders
      where listing_id = p_listing and state in ('awaiting_proof','submitted')
      order by created_at desc limit 1;
    return o;
  end if;

  select * into acct from receiving_accounts where is_active;

  loop
    code := new_order_code();
    tries := tries + 1;
    begin
      insert into payment_orders (order_code, listing_id, created_by, months, amount_usd,
                                  receiving_id, receiving_name_snapshot)
      values (code, p_listing, me, p_months, p_months * 1.00,
              acct.id, acct.display_name)
      returning * into o;
      exit;
    exception when unique_violation then
      if tries > 8 then raise; end if;
    end;
  end loop;
  return o;
end $$;

create or replace function submit_proof(p_order uuid, p_path text, p_reference text default null)
returns payment_orders
language plpgsql security definer set search_path = public as $$
declare
  o  payment_orders;
  me uuid := require_uid();
begin
  select * into o from payment_orders where id = p_order;
  if o.id is null then raise exception 'no such order'; end if;
  if o.created_by is distinct from me then raise exception 'not your order'; end if;
  if o.state not in ('awaiting_proof', 'submitted', 'rejected') then
    raise exception 'order is already %', o.state;
  end if;

  update payment_proofs set superseded = true where order_id = p_order;
  insert into payment_proofs (order_id, storage_path, claimed_tx_reference)
  values (p_order, p_path, p_reference);

  update payment_orders set state = 'submitted' where id = p_order returning * into o;
  return o;
end $$;

-- approve_ and reject_payment_order are already safe: is_admin() returns false
-- for a null uid rather than null, because it is an EXISTS.

-- Re-granting is required: CREATE OR REPLACE keeps existing grants, but
-- require_uid() is new and 0004 set the default to no EXECUTE for anyone.
revoke execute on function require_uid() from public;
