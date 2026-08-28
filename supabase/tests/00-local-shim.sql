create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, phone text);
-- Supabase enforces one account per phone number; the fixture must too, or a
-- test can sign in twice and get two identities for the same person.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_phone_key') then
    alter table auth.users add constraint users_phone_key unique (phone);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
