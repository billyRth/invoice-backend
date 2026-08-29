-- Ptas — sending what the outbox collected
--
-- Two scheduled jobs. One is plain SQL and runs in the database. The other has
-- to reach an edge function, which means an HTTP call from Postgres, which
-- means a credential — and a credential must not live in a cron command,
-- because pg_cron's job table is readable by anyone who can read the database.
-- So it goes in Vault and is read at call time.
--
-- Supabase-only: pg_net and supabase_vault do not exist on a plain Postgres.
-- supabase/tests/run.sh skips this file for the same reason it skips 0003.

-- Into `extensions`, not `public`. An extension in public puts its functions
-- and tables into the schema PostgREST exposes over HTTP, so pg_net's own
-- request and response tables become part of the API surface. Supabase's
-- linter flags it (0014_extension_in_public) and it is right to.
create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

-- The service key is inserted separately and deliberately never appears in
-- this repository:
--
--   select vault.create_secret('<service role key>', 'service_key',
--                              'used by kick_notify to call the notify function');
--
-- If the secret is missing this function does nothing rather than failing, so
-- a fresh checkout of the schema is not broken by its absence.

create or replace function kick_notify() returns text
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  key text;
  base text;
begin
  select decrypted_secret into key
    from vault.decrypted_secrets where name = 'service_key' limit 1;
  if key is null then return 'no service_key in vault; nothing sent'; end if;

  select decrypted_secret into base
    from vault.decrypted_secrets where name = 'functions_url' limit 1;
  if base is null then return 'no functions_url in vault; nothing sent'; end if;

  perform net.http_post(
    url     := base || '/notify',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'authorization', 'Bearer ' || key),
    body    := '{}'::jsonb
  );
  return 'queued';
end $$;

revoke execute on function kick_notify() from public, anon, authenticated;

-- Every five minutes. A room appearing is worth knowing about promptly; it is
-- not worth a connection per minute for the sake of four minutes.
select cron.schedule('drain-notifications', '*/5 * * * *', $$select public.kick_notify()$$);

-- Once a day, next to the sweep that pauses whatever has run out. The warning
-- goes first, so somebody who is about to lapse hears about it before it
-- happens rather than after.
select cron.schedule('warn-expiring', '7 18 * * *', $$select public.warn_expiring()$$);

-- The sender reads the outbox under the service role, which bypasses RLS but
-- still needs the grant.
grant select, update on notifications to service_role;
grant select on profiles to service_role;
