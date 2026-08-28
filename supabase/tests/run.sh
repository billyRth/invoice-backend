#!/usr/bin/env bash
# Runs the schema and its rules against a throwaway Postgres, so the guarantees
# in 0001_init.sql are checked rather than assumed. Supabase is not needed:
# 00-local-shim.sql fakes the two things Supabase adds (auth.users, auth.uid()).
#
#   supabase/tests/run.sh          # expects a Postgres on $PGHOST:$PGPORT
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-5433}" PGUSER="${PGUSER:-pg}"
psql -q -d postgres -c "drop database if exists ptas_test" -c "create database ptas_test" >/dev/null
psql -q -d ptas_test -v ON_ERROR_STOP=1 -f supabase/tests/00-local-shim.sql >/dev/null
psql -q -d ptas_test -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql -d ptas_test -f supabase/tests/rules.sql 2>&1 | grep -v '^SET$\|^RESET$\|^$'
