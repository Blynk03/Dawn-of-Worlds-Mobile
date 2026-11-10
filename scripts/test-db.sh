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

# Supabase loads pg-safeupdate for requests from the app, which rejects DELETE/UPDATE without a
# WHERE clause. Run the tests the same way when it's installed (CI requires it).
if psql -q -d "$DB" -c "load 'safeupdate'" >/dev/null 2>&1; then
  export PGOPTIONS="${PGOPTIONS:-} -c session_preload_libraries=safeupdate"
  echo "pg-safeupdate: on (like Supabase API requests)"
elif [ "${REQUIRE_SAFEUPDATE:-0}" = "1" ]; then
  echo "pg-safeupdate is required but not installed" >&2
  exit 1
else
  echo "pg-safeupdate: not installed; missing WHERE clauses won't be caught (see .github/workflows/ci.yml to install it)" >&2
fi
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/supabase_shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration"
done
for test in "$ROOT"/supabase/tests/*_test.sql; do
  echo "Running $(basename "$test")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$test"
done
