-- item 71 up: remove the duplicate HealthSync copies of one reading, keeping the
-- earliest copy. Run preflight.sql first and read its section 3: this deletes exactly
-- those rows. Every removed row is copied into item71_removed_metrics first, in the
-- same transaction, and down.sql puts them back.
--
--   psql -X -v ON_ERROR_STOP=1 -f up.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TIME ZONE 'Europe/London';
-- kb-health could insert another copy between the selection and the delete. Block
-- concurrent writes to metrics for the length of this transaction (well under a
-- second on the live table); reads are not blocked.
LOCK TABLE metrics IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE item71_scope ON COMMIT DROP AS
-- BEGIN scope (identical text in preflight.sql, up.sql and guard.sql; selftest.sh checks)
-- Which healthsync types are deduplicated, and how.
--   bp     : the two halves of a cuff reading. A reading is a systolic and a diastolic
--            stamped within 2 s of each other; two readings are copies when both
--            numbers (and units) match on the same London day.
--   single : one row is one reading; copies match on value and unit on the same day.
-- Only add a type here when preflight section 2 says it looks like re-sync copies.
-- Never a summed or nutrition type: up.sql and guard.sql refuse them.
-- The six singles were measured on live by builder, 2026-10-21 (PR #44): every one is
-- ~1 value a day with the same worst group of 8 copies as BP (one sync event).
SELECT * FROM (VALUES
  ('blood_pressure_systolic',  'bp'),
  ('blood_pressure_diastolic', 'bp'),
  ('body_fat',                 'single'),
  ('bmi',                      'single'),
  ('lean_body_mass',           'single'),
  ('height',                   'single'),
  ('respiratory_rate',         'single'),
  ('heart_rate_recovery',      'single')
) AS s(type, kind)
-- END scope
;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(type, ', ') INTO bad FROM item71_scope
   WHERE kind NOT IN ('bp', 'single')
      OR (kind = 'bp' AND type NOT IN ('blood_pressure_systolic', 'blood_pressure_diastolic'))
      OR type IN (
        -- summed types (server.ts summedMetrics): equal values on one day are real
        'steps', 'active_energy', 'basal_energy', 'flights', 'exercise_time', 'stand_time',
        'sleep', 'sleep_total', 'sleep_in_bed', 'sleep_core', 'sleep_deep', 'sleep_rem', 'sleep_awake',
        'time_in_daylight', 'walking_running_distance',
        -- nutrition types (server.ts nutritionMetrics): never deleted, whatever the source
        'calories_in', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium',
        'iron', 'calcium', 'vitamin_c', 'vitamin_a', 'vitamin_d', 'vitamin_e',
        'vitamin_k', 'vitamin_b12', 'vitamin_b6', 'magnesium', 'potassium', 'zinc', 'water',
        'biotin', 'caffeine', 'cholesterol', 'copper', 'folate', 'niacin', 'iodine',
        'fat_monounsaturated', 'fat_polyunsaturated', 'fat_saturated', 'riboflavin',
        'phosphorus', 'manganese', 'thiamin', 'selenium', 'pantothenic_acid');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'item 71: scope holds a type that must not be deduplicated by value: %', bad;
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS item71_removed_metrics AS
  SELECT m.*, now() AS item71_removed_at FROM metrics m WHERE false;

INSERT INTO item71_removed_metrics
  SELECT m.*, now() FROM metrics m JOIN item71_ids i ON i.id = m.id;

DELETE FROM metrics m
 USING item71_ids i
 WHERE m.id = i.id
   AND m.source = 'healthsync';

DO $$
DECLARE n_ids bigint; n_saved bigint; n_left bigint;
BEGIN
  SELECT count(*) INTO n_ids FROM item71_ids;
  SELECT count(*) INTO n_saved FROM item71_removed_metrics WHERE item71_removed_at = now();
  SELECT count(*) INTO n_left FROM metrics m JOIN item71_ids i ON i.id = m.id;
  IF n_saved <> n_ids OR n_left <> 0 THEN
    RAISE EXCEPTION 'item 71: selected %, backed up %, still present % - rolled back', n_ids, n_saved, n_left;
  END IF;
  RAISE NOTICE 'item 71: removed % duplicate healthsync rows (copies kept in item71_removed_metrics)', n_ids;
END $$;

\echo '== removed, by type (this run) =='
SELECT type, count(*) AS removed, min(timestamp)::date AS first_day, max(timestamp)::date AS last_day
  FROM item71_removed_metrics WHERE item71_removed_at = now()
 GROUP BY type ORDER BY type;

COMMIT;
