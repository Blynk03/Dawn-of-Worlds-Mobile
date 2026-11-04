#!/usr/bin/env bash
# Tests the Supabase migrations and row-level security on a local Postgres.
# Needs `psql` and a Postgres server you can connect to (defaults to the local socket as `postgres`).
#   ./scripts/test-db.sh
#   PGHOST=localhost PGUSER=me ./scripts/test-db.sh
set -euo pipefail

DB="dow_rls_test_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGUSER="${PGUSER:-postgres}"
export PGUSER

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/supabase_shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration"
done
for test in "$ROOT"/supabase/tests/*_test.sql; do
  echo "Running $(basename "$test")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$test"
done
