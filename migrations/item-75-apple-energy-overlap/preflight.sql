-- item 75 preflight: READ ONLY. Reports exactly what up.sql would delete, then rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TIME ZONE 'Europe/London';
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
\echo '== 1. what would be deleted, by rule and type =='
SELECT i.rule, m.type, count(*) AS rows, min(m.timestamp)::date AS first_day, max(m.timestamp)::date AS last_day
  FROM item75_ids i JOIN metrics m ON m.id = i.id GROUP BY 1,2 ORDER BY 1,2;

\echo '== 2. guard: nothing outside apple_health basal/active energy, 09-18..09-28 =='
SELECT count(*) FILTER (WHERE m.source <> 'apple_health') AS wrong_source_must_be_0,
       count(*) FILTER (WHERE m.type NOT IN ('basal_energy','active_energy')) AS wrong_type_must_be_0,
       count(*) FILTER (WHERE m.timestamp < DATE '2026-09-18' OR m.timestamp >= DATE '2026-09-29') AS wrong_day_must_be_0,
       count(*) AS total_to_delete
  FROM item75_ids i JOIN metrics m ON m.id = i.id;

\echo '== 3. per day and type: rows and total now -> after, with the clean neighbours for comparison =='
WITH s AS (
  SELECT m.id, m.type, CAST(m.timestamp AS date) AS d, m.value,
         date_trunc('minute', m.timestamp) AS mi,
         (i.id IS NOT NULL) AS doomed
    FROM metrics m LEFT JOIN item75_ids i ON i.id = m.id
   WHERE m.source='apple_health' AND m.type IN ('basal_energy','active_energy')
     AND m.timestamp >= DATE '2026-09-14' AND m.timestamp < DATE '2026-10-03'
)
SELECT d, type,
       count(*) AS rows_now, round(sum(value)::numeric,0) AS total_now,
       count(*) FILTER (WHERE NOT doomed) AS rows_after,
       round(sum(value) FILTER (WHERE NOT doomed)::numeric,0) AS total_after,
       count(DISTINCT mi) FILTER (WHERE NOT doomed) AS mins_after,
       count(*) FILTER (WHERE NOT doomed) - count(DISTINCT mi) FILTER (WHERE NOT doomed) AS excess_after
  FROM s GROUP BY 1,2 ORDER BY 1,2;

ROLLBACK;
