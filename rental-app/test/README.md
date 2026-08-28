# Testing the app against the real schema

This container cannot reach `*.supabase.co`, so `e2e.mjs` intercepts requests to
the Supabase host and forwards them to `postgrest-shim.mjs`, which runs them
against a local Postgres carrying the actual migrations and the actual RLS
policies — setting the role and JWT claim exactly as Supabase does. A policy
mistake fails here the same way it would in production.

`ptas.html` itself is never modified by the test.

```sh
# 1. a Postgres on /tmp:5433, then:
psql -d postgres -c 'create database ptas_app'
psql -d ptas_app -f supabase/tests/00-local-shim.sql
for m in 0001_init 0002_payments 0004_lock_down_functions 0005_districts; do
  psql -d ptas_app -f "supabase/migrations/$m.sql"
done
psql -d ptas_app -f supabase/seed.sql

# 2. npm i pg playwright
node rental-app/test/postgrest-shim.mjs &
node rental-app/test/e2e.mjs
```

The shim implements only the calls `ptas.html` makes. It is a fixture, not a
PostgREST clone.
