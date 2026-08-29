-- Ptas — the one function the event trigger could not catch
--
-- 0011 said "every function created in public from now on starts with no
-- EXECUTE for anon or authenticated". True, with exactly one exception it
-- could not cover: itself. lock_new_function() was created in the statement
-- *before* the event trigger that would have locked it existed, so it kept the
-- default grant and came out reachable at /rest/v1/rpc/lock_new_function.
--
-- Calling it over HTTP fails immediately - pg_event_trigger_ddl_commands()
-- raises outside an event-trigger context - so nothing was exploitable. But
-- "the guard is unguarded" is worth one line to close, and worth writing down,
-- because a bootstrap gap is invisible in the migration that creates it: the
-- rule looks complete precisely because it is being defined.
--
-- Found by the linter, on the fourth run. Which is the argument for running it
-- every time rather than once.

revoke execute on function lock_new_function() from public, anon, authenticated;
