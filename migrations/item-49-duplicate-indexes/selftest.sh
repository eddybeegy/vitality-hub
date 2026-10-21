#!/usr/bin/env bash
# item 49 self-test: builds a THROWAWAY database holding the live index layout that
# builder surveyed on 2026-10-21 (constraint-backed, app-named and idx_* copies of
# the same unique and non-unique shapes on metrics, meal_items and workouts, plus the
# prefix indexes that must survive), runs preflight -> up -> assertions -> down ->
# assertions -> up again, then drops the database.
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
names() { val "SELECT string_agg(i.relname, ',' ORDER BY i.relname COLLATE \"C\") FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid WHERE ix.indrelid = '$1'::regclass"; }

echo '== drop-selection text is identical in preflight.sql and up.sql =='
sel() { sed -n '/-- BEGIN drop-selection/,/-- END drop-selection/p' "$1"; }
[ -n "$(sel "$here/up.sql")" ] || fail 'no drop-selection block in up.sql'
diff <(sel "$here/preflight.sql") <(sel "$here/up.sql") >/dev/null || fail 'preflight.sql and up.sql select different drop lists'
echo '   OK'

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db"
trap 'psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $db" >/dev/null' EXIT

psql_db <<'SQL'
-- Same DDL the app creates on Postgres (server.ts schema, DATETIME -> TIMESTAMP),
-- trimmed to the columns that matter, then the app's own boot-time indexes.
CREATE TABLE metrics (id SERIAL PRIMARY KEY, user_id INTEGER, type TEXT, value REAL, unit TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, source TEXT, UNIQUE(user_id, type, timestamp, source));
CREATE UNIQUE INDEX metrics_unique_idx ON metrics (user_id, type, timestamp, source);
CREATE INDEX metrics_user_type_idx ON metrics (user_id, type);
CREATE INDEX metrics_user_timestamp_idx ON metrics (user_id, timestamp);
CREATE INDEX metrics_user_source_idx ON metrics (user_id, source);
CREATE INDEX metrics_user_source_ts_idx ON metrics (user_id, source, timestamp);
CREATE INDEX metrics_timestamp_idx ON metrics (timestamp);
CREATE TABLE meal_items (id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT, calories REAL,
  timestamp TIMESTAMP, source TEXT, UNIQUE(user_id, timestamp, name, source));
CREATE UNIQUE INDEX meal_items_unique_idx ON meal_items (user_id, timestamp, name, source);
CREATE INDEX meal_items_user_ts_idx ON meal_items (user_id, timestamp);
CREATE TABLE workouts (id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT, timestamp TIMESTAMP,
  source TEXT, external_id TEXT UNIQUE);
CREATE INDEX workouts_user_ts_idx ON workouts (user_id, timestamp);

-- The extra copies found live (names the app never creates), and one quoted name.
CREATE UNIQUE INDEX idx_metrics_unique ON metrics (user_id, type, timestamp, source);
CREATE INDEX idx_metrics_user_ts ON metrics (user_id, timestamp);
CREATE INDEX metrics_user_ts ON metrics (user_id, timestamp);
CREATE UNIQUE INDEX idx_meal_items_unique ON meal_items (user_id, timestamp, name, source);
CREATE UNIQUE INDEX "Quoted Meal Dup" ON meal_items (user_id, timestamp, name, source);
CREATE INDEX idx_meal_items_user_ts ON meal_items (user_id, timestamp);
CREATE INDEX idx_workouts_user_ts ON workouts (user_id, timestamp);

-- Must SURVIVE: the live prefix pair (metrics_user_type_idx is a prefix of this),
-- a reordered unique index, a partial one, and a non-unique twin of the unique shape.
CREATE INDEX idx_metrics_user_type_ts ON metrics (user_id, type, timestamp);
CREATE UNIQUE INDEX metrics_reordered_keep ON metrics (user_id, source, type, timestamp);
CREATE UNIQUE INDEX meal_items_partial_keep ON meal_items (user_id, timestamp, name, source) WHERE source = 'x';
CREATE INDEX meal_items_nonunique_keep ON meal_items (user_id, timestamp, name, source);

INSERT INTO metrics (user_id, type, value, unit, timestamp, source)
  SELECT 1, 'steps', g, 'count', timestamp '2026-10-01' + g * interval '1 minute', 'apple_health'
    FROM generate_series(1, 5000) g;
INSERT INTO meal_items (user_id, name, calories, timestamp, source)
  SELECT 1, 'meal ' || g, g, timestamp '2026-10-01' + g * interval '1 minute', 'cronometer'
    FROM generate_series(1, 2000) g;
INSERT INTO workouts (user_id, name, timestamp, source, external_id)
  SELECT 1, 'w' || g, timestamp '2026-10-01' + g * interval '1 hour', 'hevy', 'ext' || g
    FROM generate_series(1, 200) g;
SQL

M_BEFORE="$(names metrics)"; MI_BEFORE="$(names meal_items)"; W_BEFORE="$(names workouts)"
M_AFTER='idx_metrics_user_type_ts,metrics_pkey,metrics_reordered_keep,metrics_timestamp_idx,metrics_unique_idx,metrics_user_source_idx,metrics_user_source_ts_idx,metrics_user_timestamp_idx,metrics_user_type_idx'
MI_AFTER='meal_items_nonunique_keep,meal_items_partial_keep,meal_items_pkey,meal_items_unique_idx,meal_items_user_ts_idx'
W_AFTER='workouts_external_id_key,workouts_pkey,workouts_user_ts_idx'

echo '== preflight =='
out="$(psql_db -f "$here/preflight.sql")" || fail 'preflight errored'
grep -q 'metrics_user_id_type_timestamp_source_key.*UNIQUE constraint' <<<"$out" || fail 'preflight did not label the constraint'
grep -q 'idx_metrics_unique.*plain unique index' <<<"$out" || fail 'preflight did not label the plain unique index'
[ "$(grep -c 'ALTER TABLE DROP CONSTRAINT' <<<"$out")" = 2 ] || fail 'preflight should plan 2 constraint drops'
[ "$(grep -c 'DROP INDEX CONCURRENTLY' <<<"$out")" = 7 ] || fail 'preflight should plan 7 concurrent drops'
echo '   OK: labels constraint vs plain index; plans 2 constraint drops + 7 concurrent drops'

echo '== up =='
psql_db -f "$here/up.sql" >/dev/null
[ "$(names metrics)" = "$M_AFTER" ]     || fail "metrics after up: $(names metrics)"
[ "$(names meal_items)" = "$MI_AFTER" ] || fail "meal_items after up: $(names meal_items)"
[ "$(names workouts)" = "$W_AFTER" ]    || fail "workouts after up: $(names workouts)"
[ "$(val "SELECT count(*) FROM pg_constraint WHERE contype = 'u' AND conrelid IN ('metrics'::regclass, 'meal_items'::regclass)")" = 0 ] \
  || fail 'a metrics/meal_items UNIQUE constraint survived up'
[ "$(val 'SELECT count(*) FROM item49_dropped_indexes')" = 9 ] || fail 'manifest should hold 9 rows'
echo '   OK: 9 duplicates gone; keepers, prefix index and near misses intact'

echo '== uniqueness still enforced, and the app'"'"'s ON CONFLICT forms still resolve =='
psql_db <<'SQL'
INSERT INTO metrics (user_id, type, value, unit, timestamp, source) VALUES (1, 'steps', 999, 'count', timestamp '2026-10-01' + interval '1 minute', 'apple_health')
  ON CONFLICT (user_id, type, timestamp, source) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit;
INSERT INTO meal_items (user_id, name, calories, timestamp, source) VALUES (1, 'meal 1', 5, timestamp '2026-10-01' + interval '1 minute', 'cronometer')
  ON CONFLICT DO NOTHING;
INSERT INTO workouts (user_id, name, timestamp, source, external_id) VALUES (1, 'renamed', now(), 'hevy', 'ext1')
  ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name;
SQL
[ "$(val "SELECT value FROM metrics WHERE id = 1")" = 999 ] || fail 'ON CONFLICT DO UPDATE did not update'
[ "$(val 'SELECT count(*) FROM metrics')" = 5000 ]   || fail 'metrics row count changed'
[ "$(val 'SELECT count(*) FROM meal_items')" = 2000 ] || fail 'meal_items row count changed'
[ "$(val 'SELECT count(*) FROM workouts')" = 200 ]    || fail 'workouts row count changed'
if val "INSERT INTO metrics (user_id, type, value, unit, timestamp, source) VALUES (1, 'steps', 1, 'count', timestamp '2026-10-01' + interval '1 minute', 'apple_health')" >/dev/null 2>&1; then
  fail 'duplicate metrics row was accepted'
fi
echo '   OK'

echo '== up again is a no-op =='
psql_db -f "$here/up.sql" >/dev/null 2>&1
[ "$(names metrics)" = "$M_AFTER" ] || fail 'second up changed metrics'

echo '== down =='
psql_db -f "$here/down.sql" >/dev/null
[ "$(names metrics)" = "$M_BEFORE" ]     || fail "metrics after down: $(names metrics)"
[ "$(names meal_items)" = "$MI_BEFORE" ] || fail "meal_items after down: $(names meal_items)"
[ "$(names workouts)" = "$W_BEFORE" ]    || fail "workouts after down: $(names workouts)"
[ "$(val "SELECT count(*) FROM pg_constraint WHERE contype = 'u' AND conrelid IN ('metrics'::regclass, 'meal_items'::regclass)")" = 2 ] \
  || fail 'both UNIQUE constraints should be back'
[ "$(val "SELECT count(*) FROM pg_index WHERE indrelid = 'metrics'::regclass AND indisunique")" = 5 ] \
  || fail 'down did not restore uniqueness flags'
[ -z "$(val "SELECT to_regclass('item49_dropped_indexes')")" ] || fail 'manifest should be gone after down'
echo '   OK: every name, kind and both constraints restored; manifest removed'

echo '== up after down =='
psql_db -f "$here/up.sql" >/dev/null 2>&1
[ "$(names meal_items)" = "$MI_AFTER" ] || fail 'up after down'

echo '== live state after the 13:27 run and a restart: first-version manifest, constraints gone, idx_* uniques rebuilt by boot =='
psql_db -f "$here/down.sql" >/dev/null 2>&1
[ "$(names metrics)" = "$M_BEFORE" ] || fail 'down before the 13:27 scenario'
psql_db <<'SQL'
-- The manifest exactly as PR #16's up.sql wrote it: no dropped_at column.
CREATE TABLE item49_dropped_indexes (index_name text PRIMARY KEY, table_name text NOT NULL,
  constraint_name text, indexdef text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now());
INSERT INTO item49_dropped_indexes (index_name, table_name, constraint_name, indexdef)
SELECT i.relname, c.relname, con.conname, pg_get_indexdef(i.oid)
  FROM pg_class i JOIN pg_index ix ON ix.indexrelid = i.oid JOIN pg_class c ON c.oid = ix.indrelid
  LEFT JOIN pg_constraint con ON con.conindid = i.oid AND con.contype = 'u'
 WHERE i.relname IN ('metrics_user_id_type_timestamp_source_key', 'meal_items_user_id_timestamp_name_source_key',
                     'idx_metrics_unique', 'idx_meal_items_unique');
-- The 13:27 run dropped all four; a later boot rebuilt the two idx_* uniques.
ALTER TABLE metrics DROP CONSTRAINT metrics_user_id_type_timestamp_source_key;
ALTER TABLE meal_items DROP CONSTRAINT meal_items_user_id_timestamp_name_source_key;
SQL
psql_db -f "$here/up.sql" >/dev/null 2>&1 || fail 'up.sql failed from the 13:27 state'
[ "$(names metrics)" = "$M_AFTER" ]     || fail "metrics after finishing: $(names metrics)"
[ "$(names meal_items)" = "$MI_AFTER" ] || fail "meal_items after finishing: $(names meal_items)"
[ "$(names workouts)" = "$W_AFTER" ]    || fail "workouts after finishing: $(names workouts)"
[ "$(val 'SELECT count(*) FROM item49_dropped_indexes WHERE dropped_at IS NULL')" = 0 ] || fail 'manifest still claims undone drops'
[ "$(val 'SELECT count(*) FROM item49_dropped_indexes')" = 9 ] || fail 'manifest should hold 9 rows after finishing'
echo '   OK: re-run finished the job; manifest now true (9 rows, all stamped)'

echo '== safety: a shape is never left without one valid copy, whatever the manifest says =='
val "INSERT INTO item49_dropped_indexes (index_name, table_name, constraint_name, indexdef) SELECT 'metrics_unique_idx', 'metrics', NULL, pg_get_indexdef('metrics_unique_idx'::regclass)" >/dev/null
psql_db -f "$here/up.sql" >/dev/null 2>&1 || fail 'up.sql errored on the poisoned manifest'
[ -n "$(val "SELECT to_regclass('metrics_unique_idx')")" ] || fail 'up dropped the last unique index on metrics'
[ "$(val "SELECT count(*) FROM item49_dropped_indexes WHERE dropped_at IS NULL")" = 1 ] || fail 'the refused row should stay unstamped'
val "DELETE FROM item49_dropped_indexes WHERE index_name = 'metrics_unique_idx'" >/dev/null
echo '   OK: refused, and reported as not dropped'

echo '== down after the 13:27 scenario =='
psql_db -f "$here/down.sql" >/dev/null 2>&1 || fail 'down failed'
[ "$(names metrics)" = "$M_BEFORE" ] || fail "metrics after down: $(names metrics)"
psql_db -f "$here/up.sql" >/dev/null 2>&1
echo '   OK'

echo '== keeper guard: up refuses when a unique keeper is missing =='
val 'DROP TABLE item49_dropped_indexes' >/dev/null
val 'DROP INDEX metrics_unique_idx' >/dev/null
if psql_db -f "$here/up.sql" >/dev/null 2>&1; then fail 'up ran without its keeper'; fi
[ -z "$(val "SELECT to_regclass('item49_dropped_indexes')")" ] || fail 'guard tripped after the manifest was written'
echo '   OK'

echo 'ALL PASS'
