-- item 71 guard (OPTIONAL, separate from up.sql): stop NEW healthsync re-sync copies
-- at write time, inside Postgres, without touching kb-health.
--
-- kb-health (the healthsync writer, on the deploy host, not in this repo) stamps each
-- row with the SYNC time, so every re-sync of the same cuff reading gets a fresh
-- timestamp and sails past metrics_unique_idx (user_id, type, timestamp, source). The
-- real fix is in kb-health: stamp the sample's own measurement time, and the existing
-- unique index plus its ON CONFLICT dedupes copies for free. Until then this trigger
-- removes a freshly inserted healthsync row (or bp pair) that repeats a reading already
-- stored for that day, using the same rules as up.sql.
--
-- Cost: the trigger's WHEN clause is `NEW.source = 'healthsync'`, so the apple_health
-- bulk pushes never call the function. For healthsync rows of a type not in scope the
-- function is one primary-key lookup on a tiny table.
--
--   psql -X -v ON_ERROR_STOP=1 -f guard.sql      (down.sql removes it)
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS item71_dedupe_scope (type text PRIMARY KEY, kind text NOT NULL);
TRUNCATE item71_dedupe_scope;
INSERT INTO item71_dedupe_scope (type, kind)
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

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(type, ', ') INTO bad FROM item71_dedupe_scope
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

CREATE OR REPLACE FUNCTION item71_skip_healthsync_copy() RETURNS trigger
LANGUAGE plpgsql
-- the day rule: healthsync metrics are London wall-clock; after item 13 (timestamptz)
-- this keeps CAST(... AS date) on the London day whatever the writer's session zone
SET timezone = 'Europe/London'
AS $fn$
DECLARE
  k text;
  p metrics%ROWTYPE;
  n int;
  sys_v metrics.value%TYPE; dia_v metrics.value%TYPE;
  sys_u metrics.unit%TYPE; dia_u metrics.unit%TYPE; first_ts metrics.timestamp%TYPE;
BEGIN
  SELECT kind INTO k FROM item71_dedupe_scope WHERE type = NEW.type;
  IF k IS NULL THEN RETURN NULL; END IF;
  -- The row may already be gone: a multi-row insert of both bp halves fires this
  -- once per half, and the first call can remove the pair.
  PERFORM 1 FROM metrics WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF k = 'single' THEN
    IF EXISTS (SELECT 1 FROM metrics o
                WHERE o.user_id = NEW.user_id AND o.source = 'healthsync' AND o.type = NEW.type
                  AND o.id <> NEW.id
                  AND o.value = NEW.value AND o.unit IS NOT DISTINCT FROM NEW.unit
                  AND CAST(o.timestamp AS date) = CAST(NEW.timestamp AS date)
                  AND (o.timestamp, o.id) < (NEW.timestamp, NEW.id)) THEN
      DELETE FROM metrics WHERE id = NEW.id;
    END IF;
    RETURN NULL;
  END IF;

  -- bp: act once both halves of this reading are stored; until then the half waits
  -- (the partner's own insert runs this again). A half with two partners is left.
  SELECT count(*) INTO n FROM metrics o
   WHERE o.user_id = NEW.user_id AND o.source = 'healthsync'
     AND o.type IN ('blood_pressure_systolic', 'blood_pressure_diastolic') AND o.type <> NEW.type
     AND o.timestamp BETWEEN NEW.timestamp - interval '2 seconds' AND NEW.timestamp + interval '2 seconds';
  IF n <> 1 THEN RETURN NULL; END IF;
  SELECT * INTO p FROM metrics o
   WHERE o.user_id = NEW.user_id AND o.source = 'healthsync'
     AND o.type IN ('blood_pressure_systolic', 'blood_pressure_diastolic') AND o.type <> NEW.type
     AND o.timestamp BETWEEN NEW.timestamp - interval '2 seconds' AND NEW.timestamp + interval '2 seconds';

  IF NEW.type = 'blood_pressure_systolic' THEN
    sys_v := NEW.value; sys_u := NEW.unit; dia_v := p.value; dia_u := p.unit;
  ELSE
    sys_v := p.value; sys_u := p.unit; dia_v := NEW.value; dia_u := NEW.unit;
  END IF;
  first_ts := least(NEW.timestamp, p.timestamp);

  -- An earlier reading on the same day with the same two numbers: this pair is a copy.
  IF EXISTS (
    SELECT 1 FROM metrics s
      JOIN metrics d ON d.user_id = s.user_id AND d.source = 'healthsync'
                    AND d.type = 'blood_pressure_diastolic'
                    AND d.timestamp BETWEEN s.timestamp - interval '2 seconds'
                                        AND s.timestamp + interval '2 seconds'
     WHERE s.user_id = NEW.user_id AND s.source = 'healthsync' AND s.type = 'blood_pressure_systolic'
       AND s.id NOT IN (NEW.id, p.id) AND d.id NOT IN (NEW.id, p.id)
       AND s.timestamp < first_ts
       AND CAST(s.timestamp AS date) = CAST(first_ts AS date)
       AND s.value = sys_v AND s.unit IS NOT DISTINCT FROM sys_u
       AND d.value = dia_v AND d.unit IS NOT DISTINCT FROM dia_u) THEN
    DELETE FROM metrics WHERE id IN (NEW.id, p.id);
  END IF;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS item71_healthsync_copy_guard ON metrics;
CREATE TRIGGER item71_healthsync_copy_guard
  AFTER INSERT ON metrics
  FOR EACH ROW WHEN (NEW.source = 'healthsync')
  EXECUTE FUNCTION item71_skip_healthsync_copy();

COMMIT;
