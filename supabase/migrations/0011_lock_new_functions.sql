-- Ptas — stop re-learning the same lesson
--
-- This is the third migration about EXECUTE grants, and that is the point of
-- it: the previous two both fixed the functions that existed and both claimed
-- future ones would be safe, and both were wrong.
--
--   0004  revoked from PUBLIC. Correct on plain Postgres. On Supabase, new
--         functions are still granted to anon by a default privilege.
--   0008  revoked the default privilege too - but only the one owned by the
--         `postgres` role. pg_default_acl has a second entry for `supabase_admin`:
--
--           postgres       | public | f | {postgres=X, service_role=X}
--           supabase_admin | public | f | {postgres=X, anon=X, authenticated=X, ...}
--
--         so 0009's three new functions came out reachable by anon anyway.
--
-- Revoking the second default privilege would fix today and leave the same
-- trap for whoever adds the fourth. An event trigger cannot be forgotten:
-- every function created in `public` from now on starts with no EXECUTE for
-- anon or authenticated, and the only way to make one callable is to say so.

create or replace function lock_new_function() returns event_trigger
language plpgsql security definer set search_path = public as $$
declare obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
              where command_tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
  loop
    if obj.schema_name = 'public' then
      execute format('revoke execute on function %s from public, anon, authenticated',
                     obj.object_identity);
    end if;
  end loop;
end $$;

create event trigger lock_new_functions
  on ddl_command_end
  when tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
  execute function lock_new_function();

-- Revoking that second default privilege directly is not possible: migrations
-- run as `postgres`, and only supabase_admin may change supabase_admin's
-- defaults ("permission denied to change default privileges"). So the event
-- trigger above is not a belt-and-braces measure on top of a proper fix - it
-- IS the fix, and the only one available from inside a migration.

-- The three that slipped through in 0009. enqueue() is called only from other
-- SECURITY DEFINER functions, tell_watchers() only as a trigger, and
-- warn_expiring() only from cron; none has a caller over HTTP.
revoke execute on function enqueue(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function tell_watchers()                  from public, anon, authenticated;
revoke execute on function warn_expiring()                  from public, anon, authenticated;

-- search_matches() resolves `saved_searches` and `listings` against whatever
-- search_path the caller happens to have. It is not SECURITY DEFINER, so this
-- is a correctness trap rather than an escalation route, but it is one.
alter function search_matches(saved_searches, listings) set search_path = public;

-- Re-grant the ones that are meant to be reachable, since the event trigger
-- above now strips every ALTER FUNCTION too.
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
