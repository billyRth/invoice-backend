-- Ptas — close the default EXECUTE grant
--
-- Postgres grants EXECUTE on every new function to PUBLIC. The grants at the
-- end of 0001 and 0002 therefore documented an intent they did not enforce:
-- `anon` — an unauthenticated visitor with only the publishable key — could
-- POST to /rest/v1/rpc/approve_payment_order, /rpc/expire_unpaid, and the
-- trigger functions. Each of those has its own check inside, so nothing was
-- actually exploitable, but "the function refuses you" is a much thinner line
-- than "you cannot reach the function", and the second one costs nothing.
--
-- Found by Supabase's own linter, which is worth running after every migration:
--   0028_anon_security_definer_function_executable

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;

-- New functions from here on start locked too.
alter default privileges in schema public revoke execute on functions from public;

-- Now grant back, one at a time, to exactly who needs it.

-- Browsing is open to a signed-out visitor: that is the shop window.
grant execute on function search_listings(text, listing_kind[], rent_term, numeric, numeric,
                                          int, boolean, boolean, text, int, int) to anon, authenticated;

-- Everything a signed-in person does with their own listing.
grant execute on function confirm_listing(uuid)              to authenticated;
grant execute on function start_trial(uuid)                  to authenticated;
grant execute on function start_payment(uuid, int)           to authenticated;
grant execute on function submit_proof(uuid, text, text)     to authenticated;

-- The app asks this to decide whether to show the approvals queue at all.
grant execute on function is_admin()                         to authenticated;

-- Deciding money. The function checks is_admin() as well; this is the outer
-- of the two locks.
grant execute on function approve_payment_order(uuid, text)  to authenticated;
grant execute on function reject_payment_order(uuid, text)   to authenticated;

-- Deliberately granted to nobody:
--   handle_new_user(), pause_on_reports(), rent_out_listing(), touch_updated_at()
--     — trigger functions; Postgres runs them without needing a grant.
--   new_order_code()  — an implementation detail of start_payment().
--   expire_unpaid()   — pg_cron runs it as the scheduling role. No client, admin
--                       or otherwise, has a reason to sweep the whole table.

-- ------------------------------------------------------------- search_path
-- A function without a fixed search_path resolves its table names against
-- whatever the caller's search_path happens to be. For a SECURITY DEFINER
-- function that is the classic privilege-escalation route; for the rest it is
-- simply a correctness trap. The definer ones were already set; these three
-- were missed.

alter function touch_updated_at() set search_path = public;
alter function new_order_code()   set search_path = public;
alter function search_listings(text, listing_kind[], rent_term, numeric, numeric,
                               int, boolean, boolean, text, int, int) set search_path = public;

-- ------------------------------------------------------------------ admins
-- RLS on with no policy is the intended state, not an oversight: it denies
-- every client, and the only reader is is_admin(), which is SECURITY DEFINER.
-- The comment is here so the next person — or the next linter run — knows.

comment on table admins is
  'RLS enabled with no policies, deliberately. No client ever reads this table; '
  'the only reader is is_admin(), a SECURITY DEFINER function. Do not add policies.';
