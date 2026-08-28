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

The last two are worth reading before adding anything. Both were places where a
check existed, looked right, and did nothing.

## Run the linter after every migration

`get_advisors` found both of the real holes in this schema. Neither was
reachable in production — the outer lock held while the inner one was open —
and neither was visible in the function's own text.

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
