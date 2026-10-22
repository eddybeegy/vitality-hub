-- item 75 up: remove the double-counted apple_health energy rows of 2026-09-18..28.
-- Run preflight.sql first and read section 3: this deletes exactly those rows and leaves
-- every affected day at one row per minute with a day total inside the band set by the
-- clean days either side. Every removed row is copied into item75_removed_metrics in the
-- same transaction; down.sql puts them back.
--
--   psql -X -v ON_ERROR_STOP=1 -f up.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TIME ZONE 'Europe/London';
-- The ingest could write another row between the selection and the delete. Block
-- concurrent writes to metrics for the length of this transaction; reads are not blocked.
LOCK TABLE metrics IN SHARE ROW EXCLUSIVE MODE;
-- BEGIN selection (identical text in preflight.sql and up.sql)
-- Two artefacts, two rules, disjoint by day. Scope is apple_health
-- basal_energy/active_energy only, 2026-09-18..28 inclusive; no other source, type or
-- date is reachable from here.
--
-- Rule A (2026-09-27 only): the day was ingested twice, once at minute granularity
--   (second = 0, one row per minute) and once decomposed into per-second samples that
--   re-express the same energy. Delete the sub-minute rows of any minute that also holds
--   a second = 0 row. A sub-minute row whose minute has no second = 0 partner is real
--   coverage and is kept (36 such rows).
--
-- Rule B (the other ten days): the live rolling ingest (ids < 54,000,000) and the later
--   whole-history backfill (ids >= 54,000,000) both wrote these days, and on 09-28 the
--   live ingest wrote the day more than once on its own. Collapse to one row per
--   (type, minute). Which row stays is decided per (type, day) by whichever generation
--   covers more minutes of that day; inside a minute the preferred generation wins and
--   the lowest id breaks the tie. Minutes only one generation covers keep their row
--   either way, so the day ends up with the union of the two coverages, never less than
--   either alone.
CREATE TEMP TABLE item75_ids ON COMMIT DROP AS
WITH s AS (
  SELECT id, type, value, timestamp,
         CAST(timestamp AS date) AS d,
         date_trunc('minute', timestamp) AS mi,
         extract(second FROM timestamp) = 0 AS on_minute
    FROM metrics
   WHERE source = 'apple_health'
     AND type IN ('basal_energy', 'active_energy')
     AND timestamp >= DATE '2026-09-18'
     AND timestamp <  DATE '2026-09-29'
),
a_min AS (
  SELECT type, mi, bool_or(on_minute) AS has_on_minute
    FROM s WHERE d = DATE '2026-09-27' GROUP BY 1, 2
),
rule_a AS (
  SELECT s.id FROM s JOIN a_min m ON m.type = s.type AND m.mi = s.mi
   WHERE s.d = DATE '2026-09-27' AND NOT s.on_minute AND m.has_on_minute
),
b AS (
  SELECT *, (id >= 54000000) AS backfill FROM s WHERE d <> DATE '2026-09-27'
),
cover AS (
  SELECT type, d, backfill, count(DISTINCT mi) AS mins FROM b GROUP BY 1, 2, 3
),
pref AS (
  SELECT DISTINCT ON (type, d) type, d, backfill AS pref_gen
    FROM cover ORDER BY type, d, mins DESC, backfill
),
ranked AS (
  SELECT b.id,
         row_number() OVER (PARTITION BY b.type, b.mi
                            ORDER BY (b.backfill = p.pref_gen) DESC, b.id) AS rn
    FROM b JOIN pref p ON p.type = b.type AND p.d = b.d
),
rule_b AS (SELECT id FROM ranked WHERE rn > 1)
SELECT id, 'A' AS rule FROM rule_a
UNION ALL
SELECT id, 'B' FROM rule_b
-- END selection
;

DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM item75_ids i JOIN metrics m ON m.id = i.id
   WHERE m.source <> 'apple_health'
      OR m.type NOT IN ('basal_energy', 'active_energy')
      OR m.timestamp < DATE '2026-09-18' OR m.timestamp >= DATE '2026-09-29';
  IF bad <> 0 THEN
    RAISE EXCEPTION 'item 75: % selected rows are outside the declared scope - rolled back', bad;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS item75_removed_metrics AS
  SELECT m.*, now() AS item75_removed_at, ''::text AS item75_rule FROM metrics m WHERE false;

INSERT INTO item75_removed_metrics
  SELECT m.*, now(), i.rule FROM metrics m JOIN item75_ids i ON i.id = m.id;

DELETE FROM metrics m USING item75_ids i WHERE m.id = i.id;

DO $$
DECLARE n_ids bigint; n_saved bigint; n_left bigint; n_excess bigint;
BEGIN
  SELECT count(*) INTO n_ids FROM item75_ids;
  SELECT count(*) INTO n_saved FROM item75_removed_metrics WHERE item75_removed_at = now();
  SELECT count(*) INTO n_left FROM metrics m JOIN item75_ids i ON i.id = m.id;
  SELECT count(*) INTO n_excess FROM (
    SELECT 1 FROM metrics
     WHERE source = 'apple_health' AND type IN ('basal_energy', 'active_energy')
       AND timestamp >= DATE '2026-09-18' AND timestamp < DATE '2026-09-29'
     GROUP BY type, date_trunc('minute', timestamp) HAVING count(*) > 1) x;
  IF n_saved <> n_ids OR n_left <> 0 OR n_excess <> 0 THEN
    RAISE EXCEPTION 'item 75: selected %, backed up %, still present %, minutes still holding more than one row % - rolled back',
      n_ids, n_saved, n_left, n_excess;
  END IF;
  RAISE NOTICE 'item 75: removed % double-counted rows (copies kept in item75_removed_metrics)', n_ids;
END $$;

\echo '== removed, by rule and type (this run) =='
SELECT item75_rule, type, count(*) AS removed
  FROM item75_removed_metrics WHERE item75_removed_at = now()
 GROUP BY 1, 2 ORDER BY 1, 2;

\echo '== the eleven days after the delete =='
SELECT CAST(timestamp AS date) AS d, type, count(*) AS rows, round(sum(value)::numeric, 0) AS total
  FROM metrics
 WHERE source = 'apple_health' AND type IN ('basal_energy', 'active_energy')
   AND timestamp >= DATE '2026-09-18' AND timestamp < DATE '2026-09-29'
 GROUP BY 1, 2 ORDER BY 1, 2;

COMMIT;
