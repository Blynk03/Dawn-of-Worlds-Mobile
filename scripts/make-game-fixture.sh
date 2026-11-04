#!/usr/bin/env bash
# Prints a JSON fixture of a short game played by the real database functions.
# See scripts/game-fixture.sql. Needs psql and a local Postgres (like scripts/test-db.sh).
set -euo pipefail
DB="dow_fixture_$$"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PGUSER="${PGUSER:-postgres}"
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/supabase_shim.sql" >/dev/null 2>&1
for migration in "$ROOT"/supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration" >/dev/null 2>&1
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/scripts/game-fixture.sql"
