#!/usr/bin/env bash
# item 49 self-test: builds a THROWAWAY database holding the live duplicate pattern
# (metrics: 3 identical unique indexes, meal_items: 4, one of each backing the inline
# UNIQUE constraint, the rest under arbitrary names), runs preflight -> up ->
# assertions -> down -> assertions -> up again, then drops the database.
#
#   PGHOST=... PGPORT=... PGUSER=... ./selftest.sh
#
# Needs a role that can CREATE DATABASE. Never touches any existing database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="item49_selftest_$$"
psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
val() { psql -X -At -v ON_ERROR_STOP=1 -d "$db" -c "$1"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db"
trap 'psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null' EXIT

psql_db <<'SQL'
-- Same DDL the app creates on Postgres (server.ts schema, DATETIME -> TIMESTAMP),
-- trimmed to the columns that matter here, then the app's own boot-time indexes.
CREATE TABLE metrics (id SERIAL PRIMARY KEY, user_id INTEGER, type TEXT, value REAL, unit TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, source TEXT, UNIQUE(user_id, type, timestamp, source));
CREATE UNIQUE INDEX metrics_unique_idx ON metrics (user_id, type, timestamp, source);
CREATE INDEX metrics_user_type_idx ON metrics (user_id, type);
CREATE TABLE meal_items (id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT, calories REAL,
  timestamp TIMESTAMP, source TEXT, UNIQUE(user_id, timestamp, name, source));
CREATE UNIQUE INDEX meal_items_unique_idx ON meal_items (user_id, timestamp, name, source);
CREATE INDEX meal_items_user_ts_idx ON meal_items (user_id, timestamp);

-- The extra duplicates, under names the migration does not know.
CREATE UNIQUE INDEX some_other_metrics_dup ON metrics (user_id, type, timestamp, source);
CREATE UNIQUE INDEX "Quoted Meal Dup" ON meal_items (user_id, timestamp, name, source);
CREATE UNIQUE INDEX idx_meal_items_dup3 ON meal_items (user_id, timestamp, name, source);

-- Near misses that must SURVIVE: different column order, and a partial index.
CREATE UNIQUE INDEX metrics_reordered_keep ON metrics (user_id, source, type, timestamp);
CREATE UNIQUE INDEX meal_items_partial_keep ON meal_items (user_id, timestamp, name, source) WHERE source = 'x';

INSERT INTO metrics (user_id, type, value, unit, timestamp, source)
  SELECT 1, 'steps', g, 'count', timestamp '2026-10-01' + g * interval '1 minute', 'apple_health'
    FROM generate_series(1, 5000) g;
INSERT INTO meal_items (user_id, name, calories, timestamp, source)
  SELECT 1, 'meal ' || g, g, timestamp '2026-10-01' + g * interval '1 minute', 'cronometer'
    FROM generate_series(1, 2000) g;
SQL

uniq_names() { val "SELECT string_agg(i.relname, ',' ORDER BY i.relname COLLATE \"C\") FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid WHERE ix.indrelid = '$1'::regclass AND ix.indisunique"; }

echo '== preflight =='
psql_db -f "$here/preflight.sql" > /tmp/item49_preflight.$$ || fail 'preflight errored'
grep -q 'metrics_user_id_type_timestamp_source_key' /tmp/item49_preflight.$$ || fail 'preflight did not list the constraint index'
rm -f /tmp/item49_preflight.$$

echo '== up =='
psql_db -f "$here/up.sql" >/dev/null
[ "$(uniq_names metrics)" = "metrics_pkey,metrics_reordered_keep,metrics_unique_idx" ] \
  || fail "metrics unique indexes after up: $(uniq_names metrics)"
[ "$(uniq_names meal_items)" = "meal_items_partial_keep,meal_items_pkey,meal_items_unique_idx" ] \
  || fail "meal_items unique indexes after up: $(uniq_names meal_items)"
[ "$(val "SELECT count(*) FROM pg_constraint WHERE contype = 'u' AND conrelid IN ('metrics'::regclass, 'meal_items'::regclass)")" = 0 ] \
  || fail 'a UNIQUE constraint survived up'
[ "$(val 'SELECT count(*) FROM item49_dropped_indexes')" = 5 ] || fail 'manifest should hold 5 rows'
echo '   OK: 2 metrics + 3 meal_items duplicates dropped, keepers and near misses intact'

echo '== uniqueness still enforced, and the app'"'"'s ON CONFLICT forms still resolve =='
psql_db <<'SQL'
INSERT INTO metrics (user_id, type, value, unit, timestamp, source) VALUES (1, 'steps', 999, 'count', timestamp '2026-10-01' + interval '1 minute', 'apple_health')
  ON CONFLICT (user_id, type, timestamp, source) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit;
INSERT INTO meal_items (user_id, name, calories, timestamp, source) VALUES (1, 'meal 1', 5, timestamp '2026-10-01' + interval '1 minute', 'cronometer')
  ON CONFLICT DO NOTHING;
SQL
[ "$(val "SELECT value FROM metrics WHERE id = 1")" = 999 ] || fail 'ON CONFLICT DO UPDATE did not update'
[ "$(val 'SELECT count(*) FROM metrics')" = 5000 ] || fail 'metrics row count changed'
[ "$(val 'SELECT count(*) FROM meal_items')" = 2000 ] || fail 'meal_items row count changed'
if val "INSERT INTO metrics (user_id, type, value, unit, timestamp, source) VALUES (1, 'steps', 1, 'count', timestamp '2026-10-01' + interval '1 minute', 'apple_health')" >/dev/null 2>&1; then
  fail 'duplicate metrics row was accepted'
fi
echo '   OK'

echo '== up again is a no-op =='
psql_db -f "$here/up.sql" >/dev/null
[ "$(uniq_names metrics)" = "metrics_pkey,metrics_reordered_keep,metrics_unique_idx" ] || fail 'second up changed metrics'

echo '== down =='
psql_db -f "$here/down.sql" >/dev/null
[ "$(uniq_names metrics)" = "metrics_pkey,metrics_reordered_keep,metrics_unique_idx,metrics_user_id_type_timestamp_source_key,some_other_metrics_dup" ] \
  || fail "metrics after down: $(uniq_names metrics)"
[ "$(uniq_names meal_items)" = "Quoted Meal Dup,idx_meal_items_dup3,meal_items_partial_keep,meal_items_pkey,meal_items_unique_idx,meal_items_user_id_timestamp_name_source_key" ] \
  || fail "meal_items after down: $(uniq_names meal_items)"
[ "$(val "SELECT count(*) FROM pg_constraint WHERE contype = 'u' AND conrelid IN ('metrics'::regclass, 'meal_items'::regclass)")" = 2 ] \
  || fail 'both UNIQUE constraints should be back'
[ -z "$(val "SELECT to_regclass('item49_dropped_indexes')")" ] || fail 'manifest should be gone after down'
echo '   OK: every name, both constraints restored; manifest removed'

echo '== up after down =='
psql_db -f "$here/up.sql" >/dev/null
[ "$(uniq_names meal_items)" = "meal_items_partial_keep,meal_items_pkey,meal_items_unique_idx" ] || fail 'up after down'

echo '== keeper guard: up refuses when a keeper is missing =='
val 'DROP TABLE item49_dropped_indexes' >/dev/null
val 'DROP INDEX metrics_unique_idx' >/dev/null
if psql_db -f "$here/up.sql" >/dev/null 2>&1; then fail 'up ran without its keeper'; fi
[ -z "$(val "SELECT to_regclass('item49_dropped_indexes')")" ] || fail 'guard tripped after the manifest was written'
echo '   OK'

echo 'ALL PASS'
