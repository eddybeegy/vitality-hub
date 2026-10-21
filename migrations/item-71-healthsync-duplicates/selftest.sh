#!/usr/bin/env bash
# item 71 self-test: builds a THROWAWAY database shaped like the live metrics table,
# seeds healthsync re-sync copies plus every case that must survive, then runs
# preflight -> up -> assertions -> up again (no-op) -> down -> assertions -> up ->
# guard -> live inserts -> down, and drops the database.
#
#   PGHOST=... PGPORT=... PGUSER=... ./selftest.sh
#
# Needs a role that can CREATE DATABASE. Never touches any existing database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="item71_selftest_$$"
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"; }
val() { psql -X -At -v ON_ERROR_STOP=1 -d "$db" -c "$1"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
eq() { local got; got="$(val "$2")"; [ "$got" = "$3" ] || fail "$1: expected '$3', got '$got'"; echo "   ok  $1"; }

echo '== shared blocks are identical across files =='
blk() { sed -n "/-- BEGIN $1/,/-- END $1/p" "$2"; }
for f in up.sql preflight.sql guard.sql; do [ -n "$(blk scope "$here/$f")" ] || fail "no scope block in $f"; done
diff <(blk scope "$here/up.sql") <(blk scope "$here/preflight.sql") >/dev/null || fail 'scope differs: up.sql vs preflight.sql'
diff <(blk scope "$here/up.sql") <(blk scope "$here/guard.sql") >/dev/null || fail 'scope differs: up.sql vs guard.sql'
diff <(blk dup-selection "$here/up.sql") <(blk dup-selection "$here/preflight.sql") >/dev/null || fail 'dup-selection differs: up.sql vs preflight.sql'
echo '   ok'

psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db"
trap "psql -X -q -d postgres -c \"DROP DATABASE IF EXISTS $db\" >/dev/null" EXIT

run >/dev/null <<'SQL'
-- Same DDL the app creates on Postgres (server.ts schema, DATETIME -> TIMESTAMP).
CREATE TABLE metrics (id SERIAL PRIMARY KEY, user_id INTEGER, type TEXT, value REAL, unit TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, source TEXT);
CREATE UNIQUE INDEX metrics_unique_idx ON metrics (user_id, type, timestamp, source);
CREATE INDEX metrics_user_source_ts_idx ON metrics (user_id, source, timestamp);

-- a bp reading as kb-health writes it: systolic, then diastolic 5 ms later
CREATE FUNCTION bp(u int, src text, ts timestamp, s real, d real) RETURNS void LANGUAGE sql AS $$
  INSERT INTO metrics (user_id, type, value, unit, timestamp, source) VALUES
    (u, 'blood_pressure_systolic',  s, 'mmHg', ts, src),
    (u, 'blood_pressure_diastolic', d, 'mmHg', ts + interval '5 milliseconds', src);
$$;

-- A. 2026-09-09: one cuff reading re-synced 8 times (the live case). Keep the 08:26:47 one.
SELECT bp(1, 'healthsync', '2026-09-09 08:26:47'::timestamp + n * interval '22 minutes', 103, 68)
  FROM generate_series(0, 7) n;
-- B. 2026-09-17: two genuine readings sharing a diastolic, each re-synced. Keep one of each.
SELECT bp(1, 'healthsync', '2026-09-17 07:00:00'::timestamp + n * interval '1 hour', 103, 68) FROM generate_series(0, 2) n;
SELECT bp(1, 'healthsync', '2026-09-17 12:00:00'::timestamp + n * interval '1 hour', 99, 68)  FROM generate_series(0, 1) n;
-- C. same reading on the next day: a different day, kept.
SELECT bp(1, 'healthsync', '2026-09-18 08:00:00', 103, 68);
-- D. another user with the same copies: deduplicated separately, one kept.
SELECT bp(2, 'healthsync', '2026-09-09 09:00:00', 103, 68);
SELECT bp(2, 'healthsync', '2026-09-09 10:00:00', 103, 68);
-- E. other sources are never touched (apple_health 99/65 twice is live; withings too).
SELECT bp(1, 'apple_health', '2026-09-17 21:00:00', 99, 65);
SELECT bp(1, 'apple_health', '2026-09-17 22:00:00', 99, 65);
SELECT bp(1, 'withings', '2026-09-17 21:32:34', 117, 73);
SELECT bp(1, 'withings', '2026-09-17 21:40:00', 117, 73);
-- F. half with no partner, twice: untouched.
INSERT INTO metrics (user_id, type, value, unit, timestamp, source) VALUES
  (1, 'blood_pressure_systolic', 110, 'mmHg', '2026-09-20 08:00:00', 'healthsync'),
  (1, 'blood_pressure_systolic', 110, 'mmHg', '2026-09-20 09:00:00', 'healthsync');
-- G. ambiguous: one systolic, two diastolics inside 2 s. Untouched, as is an exact copy of it.
INSERT INTO metrics (user_id, type, value, unit, timestamp, source) VALUES
  (1, 'blood_pressure_systolic',  120, 'mmHg', '2026-09-21 08:00:00',     'healthsync'),
  (1, 'blood_pressure_diastolic',  80, 'mmHg', '2026-09-21 08:00:00.001', 'healthsync'),
  (1, 'blood_pressure_diastolic',  80, 'mmHg', '2026-09-21 08:00:01',     'healthsync');
SELECT bp(1, 'healthsync', '2026-09-21 09:00:00', 120, 80);
-- H. out-of-scope types: natural heart-rate repeats, summed steps, apple_health nutrition.
INSERT INTO metrics (user_id, type, value, unit, timestamp, source)
SELECT 1, 'heart_rate', 55 + n % 30, 'bpm', '2026-09-09 00:00:00'::timestamp + n * interval '5 minutes', 'healthsync' FROM generate_series(0, 99) n;
INSERT INTO metrics (user_id, type, value, unit, timestamp, source)
SELECT 1, 'steps', 12, 'count', '2026-09-09 10:00:00'::timestamp + n * interval '1 minute', 'healthsync' FROM generate_series(0, 9) n;
INSERT INTO metrics (user_id, type, value, unit, timestamp, source)
SELECT 1, 'protein', 20, 'g', '2026-09-09 12:00:00'::timestamp + n * interval '1 minute', 'apple_health' FROM generate_series(0, 4) n;
CREATE TABLE seed AS SELECT * FROM metrics;
SQL
total="$(val 'SELECT count(*) FROM metrics')"
echo "seeded $total rows"

echo '== preflight is read-only =='
run -f "$here/preflight.sql" > /tmp/item71_pre.$$ 2>&1 || { cat /tmp/item71_pre.$$; fail 'preflight failed'; }
grep -q 'IN SCOPE' /tmp/item71_pre.$$ || fail 'preflight section 1 has no IN SCOPE row'
grep -q 'natural repeats - leave' /tmp/item71_pre.$$ || fail 'preflight did not label heart_rate as natural repeats'
eq 'nothing changed' 'SELECT count(*) FROM metrics' "$total"
eq 'no backup table' "SELECT to_regclass('item71_removed_metrics') IS NULL" t
rm -f /tmp/item71_pre.$$

echo '== up =='
run -f "$here/up.sql" >/dev/null
# A: 7 pairs, B: 2+1 pairs, D: 1 pair -> 11 pairs = 22 rows
eq 'removed rows' 'SELECT count(*) FROM item71_removed_metrics' 22
eq 'metrics after' 'SELECT count(*) FROM metrics' "$((total - 22))"
eq 'A keeps the earliest copy' "SELECT string_agg(to_char(timestamp, 'HH24:MI:SS.MS') || '=' || value, ',' ORDER BY timestamp) FROM metrics WHERE user_id = 1 AND source = 'healthsync' AND timestamp::date = '2026-09-09' AND type LIKE 'blood%'" '08:26:47.000=103,08:26:47.005=68'
eq 'B keeps one of each reading' "SELECT string_agg(value::text, ',' ORDER BY timestamp, type DESC) FROM metrics WHERE user_id = 1 AND source = 'healthsync' AND timestamp::date = '2026-09-17'" '103,68,99,68'
eq 'C next day kept' "SELECT count(*) FROM metrics WHERE source = 'healthsync' AND timestamp::date = '2026-09-18'" 2
eq 'D user 2 keeps one pair' "SELECT count(*) FROM metrics WHERE user_id = 2" 2
eq 'E other sources untouched' "SELECT count(*) FROM metrics WHERE source <> 'healthsync'" "$(val "SELECT count(*) FROM seed WHERE source <> 'healthsync'")"
eq 'F/G unpaired and ambiguous untouched' "SELECT count(*) FROM metrics WHERE timestamp::date IN ('2026-09-20', '2026-09-21')" 7
eq 'H out-of-scope types untouched' "SELECT count(*) FROM metrics WHERE type IN ('heart_rate', 'steps', 'protein')" 115
eq 'no orphan halves created' "SELECT count(*) FROM metrics s WHERE s.source = 'healthsync' AND s.type = 'blood_pressure_systolic' AND s.timestamp::date NOT IN ('2026-09-20', '2026-09-21') AND NOT EXISTS (SELECT 1 FROM metrics d WHERE d.user_id = s.user_id AND d.source = s.source AND d.type = 'blood_pressure_diastolic' AND d.timestamp BETWEEN s.timestamp - interval '2 seconds' AND s.timestamp + interval '2 seconds')" 0

echo '== up again is a no-op =='
run -f "$here/up.sql" >/dev/null
eq 'still 22 in backup' 'SELECT count(*) FROM item71_removed_metrics' 22
eq 'metrics unchanged' 'SELECT count(*) FROM metrics' "$((total - 22))"

echo '== down restores every row with its id =='
run -f "$here/down.sql" >/dev/null
eq 'identical to seed' 'SELECT count(*) FROM ((SELECT * FROM metrics EXCEPT SELECT * FROM seed) UNION ALL (SELECT * FROM seed EXCEPT SELECT * FROM metrics)) x' 0
eq 'backup dropped' "SELECT to_regclass('item71_removed_metrics') IS NULL" t

echo '== up refuses a summed or nutrition type in scope =='
for bad in steps protein; do
  sed "s/('blood_pressure_diastolic', 'bp')/('blood_pressure_diastolic', 'bp'), ('$bad', 'single')/" "$here/up.sql" > /tmp/item71_bad.$$.sql
  if run -f /tmp/item71_bad.$$.sql >/dev/null 2>&1; then fail "up.sql accepted $bad"; fi
  echo "   ok  refused $bad"
done
rm -f /tmp/item71_bad.$$.sql
eq 'refusals changed nothing' 'SELECT count(*) FROM metrics' "$total"

echo '== guard stops new copies at write time =='
run -f "$here/up.sql" >/dev/null
run -f "$here/guard.sql" >/dev/null
after="$((total - 22))"
# copy of A, the two halves as two statements (kb-health style)
run -c "INSERT INTO metrics (user_id,type,value,unit,timestamp,source) VALUES (1,'blood_pressure_systolic',103,'mmHg','2026-09-09 13:00:00','healthsync')"
eq 'lone half waits for its partner' 'SELECT count(*) FROM metrics' "$((after + 1))"
run -c "INSERT INTO metrics (user_id,type,value,unit,timestamp,source) VALUES (1,'blood_pressure_diastolic',68,'mmHg','2026-09-09 13:00:00.004','healthsync')"
eq 'copy pair (two statements) removed' 'SELECT count(*) FROM metrics' "$after"
run -o /dev/null -c "SELECT bp(1, 'healthsync', '2026-09-09 14:00:00', 103, 68)"
eq 'copy pair (one statement) removed' 'SELECT count(*) FROM metrics' "$after"
run -o /dev/null -c "SELECT bp(1, 'healthsync', '2026-09-09 15:00:00', 103, 70)"
eq 'new reading sharing one number kept' 'SELECT count(*) FROM metrics' "$((after + 2))"
run -o /dev/null -c "SELECT bp(1, 'healthsync', '2026-10-01 08:00:00', 103, 68)"
eq 'first reading of a new day kept' 'SELECT count(*) FROM metrics' "$((after + 4))"
run -o /dev/null -c "SELECT bp(1, 'apple_health', '2026-09-17 23:00:00', 99, 65)"
eq 'other source kept' 'SELECT count(*) FROM metrics' "$((after + 6))"
run -c "INSERT INTO metrics (user_id,type,value,unit,timestamp,source) VALUES (1,'heart_rate',62,'bpm','2026-09-09 23:59:00','healthsync')"
eq 'out-of-scope healthsync type kept' 'SELECT count(*) FROM metrics' "$((after + 7))"
run -c "INSERT INTO item71_dedupe_scope VALUES ('weight', 'single')"
run -c "INSERT INTO metrics (user_id,type,value,unit,timestamp,source) VALUES (1,'weight',80.5,'kg','2026-09-09 07:00:00','healthsync'), (1,'weight',80.5,'kg','2026-09-09 09:00:00','healthsync'), (1,'weight',80.4,'kg','2026-09-09 10:00:00','healthsync')"
eq 'single kind: copy removed, new value kept' "SELECT string_agg(value::text, ',' ORDER BY timestamp) FROM metrics WHERE type = 'weight'" '80.5,80.4'

echo '== down removes the guard =='
run -f "$here/down.sql" >/dev/null
eq 'trigger gone' "SELECT count(*) FROM pg_trigger WHERE tgname = 'item71_healthsync_copy_guard'" 0
run -o /dev/null -c "SELECT bp(1, 'healthsync', '2026-09-09 16:00:00', 103, 68)"
eq 'copies insert normally again' "SELECT count(*) FROM metrics WHERE timestamp = '2026-09-09 16:00:00'" 1

echo 'ALL OK'
