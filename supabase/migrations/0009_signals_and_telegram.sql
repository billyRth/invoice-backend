-- Ptas — the second signal, an outbox, and saved searches
--
-- Three things that only make sense together.
--
-- 1. "Already rented" was the only report a renter could file, but it is not
--    the common failure. The common failure is that nobody picks up. Those two
--    facts have very different weights: somebody who SPOKE to the landlord and
--    was told the room is gone is near-proof, while one unanswered call at
--    lunchtime is close to nothing. Counting them the same would either pause
--    honest landlords or ignore dead numbers.
--
-- 2. Telling a landlord their listing was paused, or a renter that a room they
--    wanted appeared, needs somewhere to put the message. Not push - that
--    needs a native app nobody has installed. Telegram, which is already on
--    every phone in Cambodia and free.
--
-- 3. Renters look for weeks. A saved search that pings them is the only thing
--    here that makes somebody come back without being asked to.

-- ------------------------------------------------------------ two signals
-- Was one report per person per listing; now one per person per REASON, so
-- somebody who called on Monday and got no answer can still say "and now it is
-- rented" on Friday. Both still need distinct people.

alter table reports drop constraint reports_listing_id_reporter_id_key;
alter table reports add constraint reports_one_per_reason
  unique (listing_id, reporter_id, reason);

create or replace function pause_on_reports() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rented   int;
  noanswer int;
  l        listings;
begin
  select count(*) filter (where reason = 'already_rented'),
         -- Unanswered calls are only evidence while they are recent. A number
         -- that was busy last month says nothing about today.
         count(*) filter (where reason = 'no_answer' and created_at > now() - interval '7 days')
    into rented, noanswer
    from reports where listing_id = new.listing_id;

  if rented >= 2 or noanswer >= 3 then
    update listings set status = 'paused'
     where id = new.listing_id and status in ('trial', 'live')
    returning * into l;

    if l.id is not null then
      perform enqueue(
        l.owner_id, 'reported',
        jsonb_build_object('listing_id', l.id, 'title', l.title,
                           'why', case when rented >= 2 then 'rented' else 'no_answer' end),
        'reported:' || l.id || ':' || l.last_confirmed_at
      );
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- outbox
-- Messages are written here in the same transaction as the thing they are
-- about, and sent later by something that is allowed to fail. A trigger that
-- called Telegram directly would tie a landlord's ability to pause a listing
-- to whether an API in another country happens to be up.

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  kind        text not null check (kind in
                ('reported', 'expiring', 'search_match', 'payment_approved', 'payment_rejected')),
  payload     jsonb not null default '{}',
  -- Every message names the exact thing it is about, so the same one is never
  -- sent twice however many times its trigger fires.
  dedupe_key  text not null unique,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0,
  last_error  text
);
create index notifications_pending_idx on notifications (created_at)
  where sent_at is null;

-- Returns whether it actually queued something, so callers can report work
-- done rather than work considered.
create or replace function enqueue(p_profile uuid, p_kind text, p_payload jsonb, p_key text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into notifications (profile_id, kind, payload, dedupe_key)
  values (p_profile, p_kind, p_payload, p_key)
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- --------------------------------------------------------------- telegram
-- Telegram cannot message somebody who has not messaged the bot first, so
-- linking is renter-initiated: the app opens t.me/<bot>?start=<token>, the bot
-- reports that token back, and the chat id lands here.

alter table profiles
  add column telegram_chat_id bigint,
  add column telegram_token   text unique default encode(gen_random_bytes(9), 'hex');

create index profiles_telegram_token_idx on profiles (telegram_token);

-- ---------------------------------------------------------- saved searches

create table saved_searches (
  id          uuid primary key default gen_random_uuid(),
  renter_id   uuid not null references profiles(id) on delete cascade,
  label       text not null default '',
  max_price   numeric(10,2),
  min_beds    int,
  kinds       listing_kind[],
  districts   text[],
  term        rent_term,
  needs_car   boolean not null default false,
  needs_moto  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index saved_searches_active_idx on saved_searches (renter_id) where active;

create or replace function search_matches(sc saved_searches, l listings) returns boolean
language sql immutable as $$
  select (sc.max_price is null or l.price_usd  <= sc.max_price)
     and (sc.min_beds  is null or l.beds       >= sc.min_beds)
     and (sc.kinds     is null or l.kind        = any(sc.kinds))
     and (sc.districts is null or l.district    = any(sc.districts))
     and (sc.term      is null or l.term        = sc.term)
     and (not sc.needs_car  or l.car_parking > 0)
     and (not sc.needs_moto or l.moto_parking);
$$;

-- Fires when a listing becomes visible, not when it is created: a draft that
-- nobody has paid for is not news, and the same listing coming back from
-- paused is not news twice.
create or replace function tell_watchers() returns trigger
language plpgsql security definer set search_path = public as $$
declare sc saved_searches;
begin
  if new.status not in ('trial', 'live') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('trial', 'live') then return new; end if;

  for sc in select * from saved_searches where active loop
    -- Never tell somebody about their own room.
    if sc.renter_id <> new.owner_id and search_matches(sc, new) then
      perform enqueue(
        sc.renter_id, 'search_match',
        jsonb_build_object('listing_id', new.id, 'title', new.title,
                           'price', new.price_usd, 'district', new.district),
        'search:' || sc.id || ':' || new.id
      );
    end if;
  end loop;
  return new;
end $$;

create trigger listings_tell_watchers
  after insert or update of status on listings
  for each row execute function tell_watchers();

-- ------------------------------------------------------- the month running out
-- Three days' warning, once per paid period. Run alongside the nightly sweep.

create or replace function warn_expiring() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; l listings;
begin
  for l in select * from listings
            where status in ('trial', 'live')
              and paid_until between now() and now() + interval '3 days' loop
    if enqueue(
         l.owner_id, 'expiring',
         jsonb_build_object('listing_id', l.id, 'title', l.title,
                            'paid_until', l.paid_until,
                            'trial', l.status = 'trial'),
         'expiring:' || l.id || ':' || l.paid_until) then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------- row security

alter table notifications  enable row level security;
alter table saved_searches enable row level security;

-- Nobody reads the outbox from a client; the sender uses the service role.
comment on table notifications is
  'RLS enabled with no policies, deliberately. Written by enqueue() (SECURITY DEFINER) and drained by the notify edge function under the service role. No client has a reason to read it.';

create policy searches_own on saved_searches for all
  using (renter_id = auth.uid()) with check (renter_id = auth.uid());

grant select, insert, update, delete on saved_searches to authenticated;

-- enqueue() is called only from inside other SECURITY DEFINER functions, and
-- warn_expiring() only from cron. Neither is granted to anyone.
