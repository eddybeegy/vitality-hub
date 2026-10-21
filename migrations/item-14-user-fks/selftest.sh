#!/bin/sh
# item 14 selftest: proves the constraints actually do the three things claimed.
# Everything happens inside a transaction that is ROLLED BACK, so it is safe to run
# against live data: no user is really deleted and no row really disappears.
set -e
cd "$(dirname "$0")"
PW=$(grep -E '^(DB_PASSWORD|POSTGRES_PASSWORD|DATABASE_PASSWORD)=' ../../.env | head -1 | cut -d= -f2-)
PSQL="docker exec -i postgres env PGPASSWORD=$PW psql -h localhost -U vitality -d health -v ON_ERROR_STOP=1"

echo '== 1. all 10 constraints present, with the intended delete action =='
$PSQL -At -c "
SELECT conrelid::regclass::text || ' ' || confdeltype::text
  FROM pg_constraint
 WHERE contype = 'f' AND confrelid = 'users'::regclass AND convalidated
 ORDER BY 1;"
echo "   (c = cascade, n = set null; expect 9 x c and logs = n)"

echo '== 2. cascade really removes a child row, and logs really survives as NULL =='
$PSQL <<'SQL'
BEGIN;
-- only `id` is NOT NULL on `users`, so this is the whole row we need.
INSERT INTO users (id) VALUES (999777) ON CONFLICT (id) DO NOTHING;
INSERT INTO metrics (user_id, type, value, unit, timestamp, source)
  VALUES (999777, 'item14_selftest', 1, 'x', now(), 'item14_selftest');
INSERT INTO logs (user_id, level, message, source)
  VALUES (999777, 'info', 'item14 selftest audit line', 'item14_selftest');
DELETE FROM users WHERE id = 999777;
SELECT 'metrics_rows_left'  AS check, count(*) AS n FROM metrics WHERE source = 'item14_selftest'
UNION ALL
SELECT 'log_rows_left',       count(*) FROM logs WHERE source = 'item14_selftest'
UNION ALL
SELECT 'log_rows_now_null',   count(*) FROM logs WHERE source = 'item14_selftest' AND user_id IS NULL;
ROLLBACK;
SQL
echo "   expect metrics_rows_left 0, log_rows_left 1, log_rows_now_null 1"

echo '== 3. an unknown user_id is now REJECTED rather than silently stored =='
if $PSQL -q -c "BEGIN; INSERT INTO metrics (user_id, type, value, unit, timestamp, source) VALUES (424242, 'item14_selftest', 1, 'x', now(), 'item14_selftest'); ROLLBACK;" 2>/dev/null; then
  echo '   FAIL: insert for a nonexistent user succeeded'; exit 1
else
  echo '   OK: insert for a nonexistent user was rejected'
fi

echo '== 4. no orphans anywhere =='
$PSQL -At -f - < preflight.sql | head -20
