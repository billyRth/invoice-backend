#!/usr/bin/env bash
# Runs the schema and its rules against a throwaway Postgres, so the guarantees
# in the migrations are checked rather than assumed. Supabase is not needed:
# 00-local-shim.sql fakes the two things Supabase adds (auth.users, auth.uid()).
#
#   supabase/tests/run.sh          # expects a Postgres on $PGHOST:$PGPORT
#
# 0003 is skipped on purpose: it configures Supabase storage buckets and a
# pg_cron job, neither of which exists in a plain Postgres, and it asserts no
# rule of its own.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-5433}" PGUSER="${PGUSER:-pg}"

# Each suite seeds its own users, so each gets its own database.
for t in rules payments; do
  psql -q -d postgres -c "drop database if exists ptas_test" >/dev/null 2>&1
  psql -q -d postgres -c "create database ptas_test" >/dev/null
  psql -q -d ptas_test -v ON_ERROR_STOP=1 -f supabase/tests/00-local-shim.sql >/dev/null
  for m in 0001_init 0002_payments 0004_lock_down_functions 0005_districts; do
    psql -q -d ptas_test -v ON_ERROR_STOP=1 -f "supabase/migrations/$m.sql" >/dev/null
  done
  echo "### $t"
  psql -q -d ptas_test -f "supabase/tests/$t.sql" 2>&1 | grep -v '^SET$\|^RESET$\|^$'
done
psql -q -d postgres -c "drop database if exists ptas_test" >/dev/null 2>&1
