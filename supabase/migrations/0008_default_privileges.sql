-- Ptas — make "new functions start locked" actually true
--
-- 0004 ended with
--
--     alter default privileges in schema public revoke execute on functions from public;
--
-- and a comment claiming new functions would start locked. On a plain Postgres
-- that is true. On Supabase it is not: the project ships its own default
-- privileges granting EXECUTE on every new function to anon, authenticated and
-- service_role, and revoking PUBLIC does nothing about those.
--
-- The proof is require_uid(), added in 0007 and revoked from PUBLIC in the
-- same migration. Its ACL came out as
--
--     {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, ...}
--
-- so an unauthenticated caller could reach /rest/v1/rpc/require_uid. Harmless
-- in itself - it returns your own uid or refuses - but the rule it broke is
-- not harmless, and the next function added would have inherited the same
-- opening silently.
--
-- Found by Supabase's linter, which is the argument for running it after every
-- migration rather than once at the end.

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- Re-assert the whole list rather than patching the one that leaked, so this
-- file is a complete statement of who may call what.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function search_listings(text, listing_kind[], rent_term, numeric, numeric,
                                          int, boolean, boolean, text, text[], int, int)
  to anon, authenticated;

grant execute on function confirm_listing(uuid)              to authenticated;
grant execute on function start_trial(uuid)                  to authenticated;
grant execute on function start_payment(uuid, int)           to authenticated;
grant execute on function submit_proof(uuid, text, text)     to authenticated;
grant execute on function is_admin()                         to authenticated;
grant execute on function approve_payment_order(uuid, text)  to authenticated;
grant execute on function reject_payment_order(uuid, text)   to authenticated;

-- require_uid() is called only from inside other functions, which run as their
-- definer and need no grant. Nobody reaches it over HTTP.
