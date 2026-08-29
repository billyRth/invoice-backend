# Ptas database

One migration, `migrations/0001_init.sql`. Read it top to bottom; it is ordered
the way the product works, not the way SQL textbooks are.

## The three rules the database enforces by itself

A client cannot get these wrong, because they are triggers and policies rather
than app code:

1. **A listing is visible only while somebody is paying for it.**
   `status in ('trial','live')` is the public read policy. `expire_unpaid()`
   runs nightly and pauses anything whose `paid_until` has passed.
2. **Paying is never automatic.** There is no subscription token anywhere —
   `listing_periods` is one row per month actually bought. If renewal were
   automatic, a rented room would keep paying and keep showing, which is
   exactly the failure every Cambodian rental page has today.
3. **A rented room leaves the market.** Inserting a `tenancies` row flips the
   listing to `rented`. The landlord does it because they want the rent record,
   and the market gets a cleaner index for free.

Plus the two supporting ones: two renter reports pause a listing until the
landlord confirms it again (`confirm_listing()` clears the reports and restarts
the clock), and anything unconfirmed for 14 days sinks below everything else in
`search_listings()` whatever the sort — including below more expensive rooms
when the renter asked for cheapest first.

## Who can see what

| table | anon | signed-in renter | owner |
|---|---|---|---|
| `listings` | paid ones only | paid ones only | all of their own |
| `listing_photos` | on paid listings | on paid listings | all of their own |
| `profiles` | – | own row | own row |
| `saved` | – | own rows | – |
| `reports` | – | insert; read own | count via their listing |
| `tenancies` | – | own tenancy | own tenancy |
| `listing_periods` | – | own payments | own payments |

Contact name and phone are copied onto the listing rather than joined from
`profiles`, for two reasons: the contact is often an agent or a relative, and
nobody should be able to browse the user table to harvest numbers.

## Running the tests

The rules above are checked, not assumed:

```sh
supabase/tests/run.sh        # against any local Postgres
```

`00-local-shim.sql` fakes the only two things Supabase adds (`auth.users` and
`auth.uid()`), so this needs no Supabase account and no network.

## Not in this migration yet

* KHQR payment webhook — writes `listing_periods` with the service role.
  Needs an ABA PayWay merchant account first.
* The `listing-photos` storage bucket and its policies.
* `pg_cron` schedule for `expire_unpaid()` (one line, once the project exists).

## Migrations, and why each exists

| | |
|---|---|
| `0001_init` | the seven tables and the three rules |
| `0002_payments` | KHQR by hand: orders, receipts, approval |
| `0003_storage_and_cron` | buckets, and the nightly sweep (Supabase-only) |
| `0004_lock_down_functions` | Postgres grants EXECUTE to PUBLIC; this takes it back |
| `0005_districts` | the fourteen khans, as a foreign key rather than free text |
| `0006_district_centres` | where a new listing's pin starts, and that it is approximate |
| `0007_null_uid_guards` | `owner_id <> auth.uid()` does not fire when uid is null |
| `0008_default_privileges` | Supabase grants new functions to anon; 0004's promise made real |
| `0009_signals_and_telegram` | the second report reason, the outbox, saved searches |
| `0010_notify_schedule` | cron for sending and for the expiry warning (Supabase-only) |
| `0011_lock_new_functions` | an event trigger, because 0004 and 0008 both failed to stick |
| `0012_lock_the_locker` | the event trigger could not lock itself |
| `0013_payment_messages` | approval and rejection were never told to anyone |
| `0014_record_tenancy` | link the tenancy to the tenant, by phone |
| `0015_tenant_sees_the_room` | a tenant could read their tenancy but not the room |

The last two are worth reading before adding anything. Both were places where a
check existed, looked right, and did nothing.

## Run the linter after every migration

`get_advisors` found every grant problem in this schema, three times running,
and none of them was visible in the function's own text.

The third time is the interesting one. 0004 revoked `EXECUTE` from `PUBLIC`,
which is correct on plain Postgres. 0008 also revoked the default privilege
that grants new functions to `anon` — but `pg_default_acl` has *two* entries
for `public` functions:

```
postgres       | public | f | {postgres=X, service_role=X}
supabase_admin | public | f | {postgres=X, anon=X, authenticated=X, ...}
```

0008 only fixed the first, so 0009's three new functions came out reachable by
`anon` anyway. The second cannot be fixed from a migration at all — migrations
run as `postgres`, and altering `supabase_admin`'s defaults is *permission
denied*.

So 0011 uses an event trigger instead: every function created in `public` has
`EXECUTE` revoked from `anon` and `authenticated` the moment it exists, and the
only way to make one callable is to grant it explicitly. Two migrations tried
to fix the functions that existed and promised the next ones would be safe.
This one makes it structural rather than remembered — with exactly one gap it
could not cover, closed in 0012: `lock_new_function()` itself was created in
the statement *before* the trigger that would have locked it, so it kept the
default grant. A bootstrap gap is invisible in the migration that creates it,
because the rule looks complete precisely while it is being defined.

## Operating it, before there are screens for any of this

**Make someone an admin** (only an admin can approve money). They have to have
signed in once, so a row exists:

```sql
insert into admins (profile_id, note)
select id, 'owner' from profiles where phone = '+855XXXXXXXX';
```

**Set the account landlords pay into.** Upload the KHQR image to the `khqr`
bucket first, then:

```sql
insert into receiving_accounts (version, display_name, bank, account_no, qr_path, is_active, activated_at)
values (1, 'PTAS / YOUR NAME', 'ABA', '000 000 000', 'v1.png', true, now());
```

Only one row may be active. To replace it, deactivate the old one and insert a
new version — never edit a row, because every payment order points at the exact
version the landlord was shown.

**The approval queue**, until it has a screen:

```sql
select o.order_code, o.amount_usd, l.title, p.storage_path, p.claimed_tx_reference
from payment_orders o
join listings l on l.id = o.listing_id
left join payment_proofs p on p.order_id = o.id and not p.superseded
where o.state = 'submitted'
order by o.created_at;

-- match the receipt to your bank statement, then:
select approve_payment_order('<order id>', '<bank reference>');
select reject_payment_order('<order id>', 'could not find this transfer');
```

Approving is idempotent: tapping it twice does not sell two months.


## Reports are weighed, not counted

Two reasons, two thresholds, because they are not the same evidence:

* **already rented** — somebody spoke to the landlord and was told. Near-proof.
  **Two** distinct people pause the listing.
* **no answer** — one unanswered call at lunchtime means almost nothing.
  **Three** distinct people, and only ones from the **last seven days**, pause it.

Counting them the same would either pause honest landlords on two missed calls
or leave dead numbers up for weeks. Both thresholds are in `pause_on_reports()`;
the app's copies exist only to word the confirmation message.

## Messages go through an outbox

Triggers write to `notifications` in the same transaction as the thing the
message is about; the `notify` edge function sends them later. That separation
is deliberate — pausing a listing must not depend on an API in another country
being reachable, and a failed send has to be retryable without re-running the
trigger. Every message carries a `dedupe_key`, so the same one is never sent
twice however many times its trigger fires.

## Switching Telegram on

Nothing sends until these exist. Until then messages simply queue, and are
delivered when they do.

1. Make a bot with [@BotFather](https://t.me/BotFather), take the token.
2. In the dashboard, Edge Functions → Secrets, add `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET` (any long random string), and `PTAS_APP_URL`
   (your Netlify link, so messages carry one).
3. Point Telegram at the webhook:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project>.supabase.co/functions/v1/telegram-webhook&secret_token=<SECRET>"
   ```
4. Let cron reach the sender:
   ```sql
   select vault.create_secret('<service role key>', 'service_key', 'used by kick_notify');
   ```
5. Set `PTAS_BOT` in `ptas.html` to the bot's username.


## A tenancy has two parties, and both can see it

`record_tenancy()` is the only way to create one. It looks the tenant up by
phone — normalising `012 345 678` and `+85512345678` to the same thing — and
sets `tenant_id` when they already have an account. A tenant with no account is
still recorded, by name and number, with a null `tenant_id`; that is the common
case at first, because the room is usually rented before the renter has ever
opened the app.

The lookup lives in the function rather than the client because `profiles` is
readable only by its owner, deliberately, so nobody can walk the user table
harvesting numbers.

`listings_tenant_read` then lets both parties read the room itself. Without it
the tenant hit an odd wall: recording the tenancy takes the room off the
market, so the moment their record existed they lost sight of the listing it
pointed at, and their own screen could not say which room it was for.
