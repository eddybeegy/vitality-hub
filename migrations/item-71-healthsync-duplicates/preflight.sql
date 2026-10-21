-- item 71 preflight: READ THIS OUTPUT BEFORE RUNNING up.sql. Read-only: everything
-- runs in a transaction that is rolled back, and the only tables it creates are
-- temporary.
--
--   psql -X -v ON_ERROR_STOP=1 -f preflight.sql
--
-- Section 1 is the evidence for which healthsync types carry re-sync copies.
-- Section 3 is exactly what up.sql will delete.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TIME ZONE 'Europe/London';

CREATE TEMP TABLE item71_scope ON COMMIT DROP AS
-- BEGIN scope (identical text in preflight.sql, up.sql and guard.sql; selftest.sh checks)
-- Which healthsync types are deduplicated, and how.
--   bp     : the two halves of a cuff reading. A reading is a systolic and a diastolic
--            stamped within 2 s of each other; two readings are copies when both
--            numbers (and units) match on the same London day.
--   single : one row is one reading; copies match on value and unit on the same day.
-- Only add a type here when preflight section 2 says it looks like re-sync copies.
-- Never a summed or nutrition type: up.sql and guard.sql refuse them.
SELECT * FROM (VALUES
  ('blood_pressure_systolic',  'bp'),
  ('blood_pressure_diastolic', 'bp')
) AS s(type, kind)
-- END scope
;

CREATE TEMP TABLE item71_ids ON COMMIT DROP AS
-- BEGIN dup-selection (identical text in preflight.sql and up.sql; selftest.sh checks)
WITH hs AS (
  SELECT m.id, m.user_id, m.type, m.value, m.unit, m.timestamp, s.kind
    FROM metrics m
    JOIN item71_scope s ON s.type = m.type
   WHERE m.source = 'healthsync'
),
-- bp: pair each systolic with the diastolic stamped within 2 s. Only one-to-one
-- matches count; a half with no partner, or with two, is never touched.
cand AS (
  SELECT s.id AS sys_id, d.id AS dia_id, s.user_id, s.timestamp AS ts,
         s.value AS sv, s.unit AS su, d.value AS dv, d.unit AS du
    FROM hs s
    JOIN hs d ON d.user_id = s.user_id
             AND d.type = 'blood_pressure_diastolic'
             AND d.timestamp BETWEEN s.timestamp - interval '2 seconds'
                                 AND s.timestamp + interval '2 seconds'
   WHERE s.type = 'blood_pressure_systolic'
),
pairs AS (
  SELECT c.* FROM cand c
   WHERE (SELECT count(*) FROM cand x WHERE x.sys_id = c.sys_id) = 1
     AND (SELECT count(*) FROM cand x WHERE x.dia_id = c.dia_id) = 1
),
pair_ranked AS (
  SELECT sys_id, dia_id,
         row_number() OVER (PARTITION BY user_id, CAST(ts AS date), sv, su, dv, du
                            ORDER BY ts, sys_id) AS rn
    FROM pairs
),
single_ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id, type, CAST(timestamp AS date), value, unit
                            ORDER BY timestamp, id) AS rn
    FROM hs
   WHERE kind = 'single'
)
SELECT sys_id AS id FROM pair_ranked WHERE rn > 1
UNION ALL
SELECT dia_id FROM pair_ranked WHERE rn > 1
UNION ALL
SELECT id FROM single_ranked WHERE rn > 1
-- END dup-selection
;

\echo '== 1. every healthsync metric type: how many rows are value-identical copies on the same day =='
-- copies       = rows that repeat an earlier (day, value, unit) of the same type
-- values_per_day = distinct values on an average day. A spot measurement re-synced
--                looks like ~1 value a day with copies > 0. A high-frequency type
--                (heart_rate) repeats values naturally and must not be deduplicated
--                by value; summed and nutrition types never are.
WITH g AS (
  SELECT type, CAST(timestamp AS date) AS day, value, unit, count(*) AS n
    FROM metrics WHERE source = 'healthsync'
   GROUP BY 1, 2, 3, 4
), t AS (
  SELECT type, sum(n) AS rows, count(DISTINCT day) AS days, sum(n) - count(*) AS copies,
         round(count(*)::numeric / count(DISTINCT day), 1) AS values_per_day,
         max(n) AS worst_group
    FROM g GROUP BY type
)
SELECT t.type, t.rows, t.days, t.copies, t.values_per_day, t.worst_group,
       CASE WHEN EXISTS (SELECT 1 FROM item71_scope s WHERE s.type = t.type) THEN 'IN SCOPE'
            WHEN t.type IN ('steps', 'active_energy', 'basal_energy', 'flights', 'exercise_time', 'stand_time',
                            'sleep', 'sleep_total', 'sleep_in_bed', 'sleep_core', 'sleep_deep', 'sleep_rem', 'sleep_awake',
                            'time_in_daylight', 'walking_running_distance') THEN 'summed type - never by value'
            WHEN t.copies = 0 THEN 'no copies'
            WHEN t.values_per_day <= 2 THEN 'looks like re-sync copies - candidate'
            ELSE 'natural repeats - leave' END AS verdict
  FROM t ORDER BY t.copies DESC, t.type;

\echo '== 2. blood pressure halves: in a one-to-one pair (eligible) vs left alone =='
WITH hs AS (
  SELECT id, user_id, type, timestamp FROM metrics
   WHERE source = 'healthsync' AND type IN ('blood_pressure_systolic', 'blood_pressure_diastolic')
), c AS (
  SELECT h.id, o.id AS partner
    FROM hs h
    LEFT JOIN hs o ON o.user_id = h.user_id AND o.type <> h.type
                  AND o.timestamp BETWEEN h.timestamp - interval '2 seconds'
                                      AND h.timestamp + interval '2 seconds'
), n AS (
  SELECT id, count(partner) AS partners, min(partner) AS partner FROM c GROUP BY id
)
SELECT h.type,
       count(*) FILTER (WHERE n.partners = 1 AND p.partners = 1) AS one_to_one_eligible,
       count(*) FILTER (WHERE n.partners = 0) AS no_partner_untouched,
       count(*) FILTER (WHERE n.partners > 1 OR (n.partners = 1 AND p.partners > 1)) AS ambiguous_untouched
  FROM hs h JOIN n ON n.id = h.id LEFT JOIN n p ON p.id = n.partner
 GROUP BY h.type ORDER BY h.type;

\echo '== 3. EXACTLY what up.sql will delete (earliest copy of each reading is kept) =='
SELECT m.type, count(*) AS to_delete, min(m.timestamp)::date AS first_day, max(m.timestamp)::date AS last_day
  FROM metrics m JOIN item71_ids i ON i.id = m.id
 GROUP BY m.type ORDER BY m.type;
SELECT count(*) AS total_to_delete,
       count(*) FILTER (WHERE m.source <> 'healthsync') AS not_healthsync_must_be_0
  FROM metrics m JOIN item71_ids i ON i.id = m.id;

\echo '== 4. per day for blood pressure: rows now -> rows after, and the reading that stays =='
SELECT CAST(m.timestamp AS date) AS day,
       count(*) FILTER (WHERE m.type = 'blood_pressure_systolic') AS sys_rows_now,
       count(*) FILTER (WHERE m.type = 'blood_pressure_systolic' AND i.id IS NULL) AS sys_rows_after,
       string_agg(DISTINCT CASE WHEN m.type = 'blood_pressure_systolic' AND i.id IS NULL THEN m.value::text END, ', ') AS systolic_kept,
       string_agg(DISTINCT CASE WHEN m.type = 'blood_pressure_diastolic' AND i.id IS NULL THEN m.value::text END, ', ') AS diastolic_kept
  FROM metrics m LEFT JOIN item71_ids i ON i.id = m.id
 WHERE m.source = 'healthsync' AND m.type IN ('blood_pressure_systolic', 'blood_pressure_diastolic')
 GROUP BY 1 HAVING count(*) FILTER (WHERE i.id IS NOT NULL) > 0
 ORDER BY 1;

\echo '== 5. for information only, NOT touched: identical BP copies from other sources =='
SELECT source, type, sum(n - 1) AS copies
  FROM (SELECT source, type, CAST(timestamp AS date) AS d, value, count(*) AS n
          FROM metrics
         WHERE source <> 'healthsync' AND type IN ('blood_pressure_systolic', 'blood_pressure_diastolic')
         GROUP BY 1, 2, 3, 4) g
 WHERE n > 1 GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== 6. state: backup table and guard trigger =='
SELECT to_regclass('public.item71_removed_metrics') IS NOT NULL AS backup_table_exists,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'item71_healthsync_copy_guard') AS guard_installed;

ROLLBACK;
