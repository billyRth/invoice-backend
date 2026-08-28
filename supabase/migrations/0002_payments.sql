-- Ptas — taking the $1
--
-- There is no bank API here on purpose. ABA PayWay needs a merchant account
-- and a signed agreement, which does not exist yet, and the whole business
-- can start without one: the app shows the owner's KHQR, the landlord pays
-- from any Cambodian banking app, and uploads the receipt. Somebody checks it.
--
-- That is the same shape as `property-billing`, which already runs this way,
-- so it is a known-workable flow rather than a guess. Swapping in a real
-- webhook later means calling approve_payment_order() from a server instead of
-- from an admin's thumb; nothing else in this file changes.

create type order_state as enum ('awaiting_proof', 'submitted', 'approved', 'rejected', 'expired');

-- Who is allowed to approve money. Deliberately a table and not a flag on
-- profiles, so that granting it is a visible, auditable insert.
create table admins (
  profile_id uuid primary key references profiles(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where profile_id = auth.uid());
$$;

-- ------------------------------------------------------- where the money goes
-- Versioned and immutable. A payment order points at the exact version that
-- was on screen when it was created, so changing the account later can never
-- rewrite what a landlord was actually shown.

create table receiving_accounts (
  id           uuid primary key default gen_random_uuid(),
  version      int  not null,
  display_name text not null,            -- e.g. "PTAS / SOK DARA"
  bank         text not null default 'ABA',
  account_no   text,
  qr_path      text not null,            -- object key in the `khqr` bucket
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  activated_at timestamptz,
  unique (version)
);
create unique index receiving_accounts_one_active on receiving_accounts ((true)) where is_active;

-- --------------------------------------------------------------- the orders

create table payment_orders (
  id            uuid primary key default gen_random_uuid(),
  order_code    text not null unique,    -- short code the payer types in the note
  listing_id    uuid not null references listings(id) on delete cascade,
  created_by    uuid not null references profiles(id),
  months        int  not null check (months between 1 and 12),
  amount_usd    numeric(10,2) not null check (amount_usd >= 0),
  receiving_id  uuid references receiving_accounts(id),
  receiving_name_snapshot text,
  state         order_state not null default 'awaiting_proof',
  decided_by    uuid references profiles(id),
  decided_at    timestamptz,
  reject_reason text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '2 days'
);
create index payment_orders_listing_idx on payment_orders (listing_id, created_at desc);
create index payment_orders_open_idx    on payment_orders (state) where state in ('awaiting_proof','submitted');

create table payment_proofs (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references payment_orders(id) on delete cascade,
  storage_path  text not null,
  claimed_tx_reference text,
  submitted_at  timestamptz not null default now(),
  superseded    boolean not null default false
);
create index payment_proofs_order_idx on payment_proofs (order_id, submitted_at desc);

-- A human-typeable code. Ambiguous characters are left out because this gets
-- copied into a bank transfer note on a phone, by hand, once per month.
create or replace function new_order_code() returns text
language plpgsql as $$
declare
  alphabet text := '3456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  out text := '';
  i int;
begin
  for i in 1..6 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'P-' || out;
end $$;

-- ---------------------------------------------------------------- the flow

-- 1. The landlord asks to publish. They get a code and a QR to pay against.
create or replace function start_payment(p_listing uuid, p_months int default 1)
returns payment_orders
language plpgsql security definer set search_path = public as $$
declare
  l listings;
  acct receiving_accounts;
  o payment_orders;
  code text;
  tries int := 0;
begin
  select * into l from listings where id = p_listing;
  if l.id is null then raise exception 'no such listing'; end if;
  if l.owner_id <> auth.uid() then raise exception 'not your listing'; end if;
  if p_months < 1 or p_months > 12 then raise exception 'months out of range'; end if;

  -- Never let a landlord stack open orders on one listing; they would pay
  -- twice against two codes and blame us.
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
      values (code, p_listing, auth.uid(), p_months, p_months * 1.00,
              acct.id, acct.display_name)
      returning * into o;
      exit;
    exception when unique_violation then
      if tries > 8 then raise; end if;
    end;
  end loop;
  return o;
end $$;

-- 2. They upload the receipt. State moves so an admin sees it in a queue.
create or replace function submit_proof(p_order uuid, p_path text, p_reference text default null)
returns payment_orders
language plpgsql security definer set search_path = public as $$
declare o payment_orders;
begin
  select * into o from payment_orders where id = p_order;
  if o.id is null then raise exception 'no such order'; end if;
  if o.created_by <> auth.uid() then raise exception 'not your order'; end if;
  if o.state not in ('awaiting_proof', 'submitted', 'rejected') then
    raise exception 'order is already %', o.state;
  end if;

  update payment_proofs set superseded = true where order_id = p_order;
  insert into payment_proofs (order_id, storage_path, claimed_tx_reference)
  values (p_order, p_path, p_reference);

  update payment_orders set state = 'submitted' where id = p_order returning * into o;
  return o;
end $$;

-- 3. Approval is the only thing that makes a listing visible. It writes the
--    month that was bought, extends the clock, and — this is the part that
--    matters — counts as a confirmation, because a landlord who just paid for
--    a room is telling you the room is still free.
create or replace function approve_payment_order(p_order uuid, p_reference text default null)
returns listings
language plpgsql security definer set search_path = public as $$
declare
  o payment_orders;
  l listings;
  from_ts timestamptz;
begin
  if not is_admin() then raise exception 'not an admin'; end if;

  select * into o from payment_orders where id = p_order for update;
  if o.id is null then raise exception 'no such order'; end if;
  if o.state = 'approved' then
    select * into l from listings where id = o.listing_id;
    return l;                                  -- idempotent: double-tap is safe
  end if;

  select * into l from listings where id = o.listing_id for update;
  from_ts := greatest(coalesce(l.paid_until, now()), now());

  insert into listing_periods (listing_id, paid_by, amount_usd, method, reference, starts_at, ends_at)
  values (o.listing_id, o.created_by, o.amount_usd, 'khqr',
          coalesce(p_reference, o.order_code),
          from_ts, from_ts + (o.months || ' months')::interval);

  update payment_orders
     set state = 'approved', decided_by = auth.uid(), decided_at = now()
   where id = p_order;

  update listings
     set paid_until = from_ts + (o.months || ' months')::interval,
         status = case when status in ('draft','trial','paused') then 'live' else status end,
         last_confirmed_at = now()
   where id = o.listing_id
  returning * into l;

  delete from reports where listing_id = o.listing_id;
  return l;
end $$;

create or replace function reject_payment_order(p_order uuid, p_reason text)
returns payment_orders
language plpgsql security definer set search_path = public as $$
declare o payment_orders;
begin
  if not is_admin() then raise exception 'not an admin'; end if;
  update payment_orders
     set state = 'rejected', decided_by = auth.uid(), decided_at = now(), reject_reason = p_reason
   where id = p_order and state <> 'approved'
  returning * into o;
  if o.id is null then raise exception 'no such open order'; end if;
  return o;
end $$;

-- The 14 free days, once per landlord ever. Not once per listing: otherwise
-- somebody posts the same room every fortnight and never pays.
create or replace function start_trial(p_listing uuid)
returns listings
language plpgsql security definer set search_path = public as $$
declare l listings;
begin
  select * into l from listings where id = p_listing;
  if l.id is null then raise exception 'no such listing'; end if;
  if l.owner_id <> auth.uid() then raise exception 'not your listing'; end if;
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

-- ------------------------------------------------------------- row security

alter table admins             enable row level security;
alter table receiving_accounts enable row level security;
alter table payment_orders     enable row level security;
alter table payment_proofs     enable row level security;

-- Nobody reads the admin list from a client, not even admins.
create policy accounts_read on receiving_accounts for select to anon, authenticated
  using (is_active);

create policy orders_own_read on payment_orders for select
  using (created_by = auth.uid() or is_admin());
create policy proofs_own_read on payment_proofs for select
  using (exists (select 1 from payment_orders o
                  where o.id = order_id and (o.created_by = auth.uid() or is_admin())));

-- Orders and proofs are written only through the functions above, which check
-- ownership and state. No direct insert grant is given to anyone.

grant select on receiving_accounts, payment_orders, payment_proofs to authenticated;
grant select on receiving_accounts to anon;
grant execute on function start_payment(uuid, int)            to authenticated;
grant execute on function submit_proof(uuid, text, text)      to authenticated;
grant execute on function start_trial(uuid)                   to authenticated;
grant execute on function approve_payment_order(uuid, text)   to authenticated;
grant execute on function reject_payment_order(uuid, text)    to authenticated;
grant execute on function is_admin()                          to authenticated;
