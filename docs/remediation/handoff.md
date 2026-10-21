---
type: note
title: Vitality-hub outstanding items — handoff brief for a claude.ai project session
description: Self-contained context pack so a cloud session working from the eddybeegy/vitality-hub repo can produce patches/PRs for the front-end and validation items without ser5 access. Written 2026-10-21 by builder.
tags: [vitality-hub, remediation, handoff]
---

# Vitality-hub — handoff brief for a repo-only session

Repo: `eddybeegy/vitality-hub`, branch `main`, HEAD at time of writing `5c6719b`.
Deploy target is a private host (`ser5`) you do not have access to. **Produce
branches + PRs, do not expect to verify at runtime.** builder deploys and verifies.

## Ground rules for patches

- `server.ts` is a single ~3600-line Express file and is the hottest file in the
  repo — builder is also editing it. Touch it only for items that name it, and keep
  each PR to one item so conflicts stay resolvable.
- **Two tsc errors are pre-existing and must be left alone**:
  `src/components/Dashboard.tsx(1441,98)` (`readiness_recovery_days` missing from
  `Settings`) and `vite.config.ts(5,15)` (`UserConfig` not exported by
  `vitest/config`). Any third error is yours.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Timezone: the instance runs for a single Europe/London user; the container
  process is UTC. **Never** build a date by formatting to a locale string and
  reparsing it — that was the root cause of item 6. Format to Y-M-D, then do
  `Date.UTC` arithmetic.
- BST ends 2026-10-25. Any timezone fix must be tested with an explicit offset,
  not against the current clock, or it will silently pass for four months.

## Facts you cannot derive from the repo (established by measurement on the host)

1. **`metrics.timestamp` and `workouts.timestamp` are `timestamp without time
   zone` and hold a different zone per source.** The five in-app modules
   (`modules/apple_health.ts`, `cronometer.ts`, `withings.ts`, `nutracheck.ts`,
   `hevy.ts`) all end in `new Date(...).toISOString()` → **UTC**. `healthsync`
   has **no module in this repo** — it is an external writer (HealthSync → Home
   Assistant → Postgres) and stamps **Europe/London wall-clock**. `logs.timestamp`
   takes the column DEFAULT `CURRENT_TIMESTAMP` in the PG session zone
   (Europe/London) → **London wall-clock**. So no single `AT TIME ZONE` is correct
   for the table. SQL read paths now `CASE` on source; the JS read paths still
   don't (item 44).
2. **The Nutracheck module tags rows `nutrachek`** (one 'c'). Both spellings are
   in `SOURCE_RANK` at the same rank; don't "fix" one away.
3. `metric_priorities` only names weight, body_fat, muscle_mass, calories_in and
   blood_pressure, so anything keyed off it misses every high-frequency type.
4. Apple Health is **not** dead despite what item 18 says: 1,595,487 metric rows,
   newest 09:48 London on 2026-10-21. Its *workouts* feed is stale (newest
   2026-10-13) — that's item 39.
5. apple_health **nutrition** is at 0 rows — a boot-time purge (now removed) had
   been deleting it. History is unrecoverable; only new Health Auto Export pushes
   repopulate.
6. Kieron's decision, 2026-10-21 10:25: keep Apple Health nutrition, but never
   surface it on a day cronometer (or a future nutrition source) covers.
   Precedence is a **read** concern — do not reintroduce any DELETE.

## Good candidates for a repo-only session

Self-contained, mostly front-end, verifiable by reading the code:

- **#22 SLEEP STAGES headlines measure different things.** Root-caused:
  `src/components/HealthChart.tsx:299` — `periodStats` sums all `stackKeys` for
  `latest` but averages only `item[dataKey]`, so the headline and the average are
  different quantities. Pick one and make both agree.
- **#24 Nutrition Insights overflows at ≤390 px.**
- **#27 Debug Tools panels are dead wiring.** Root-caused: two reads of files
  that nothing in the repo writes, and `setDebugMetrics`/`setLastMetrics` are
  never called. Server endpoints work. Both panels also lack `dark:` variants
  (2.43:1 contrast). Either wire them to the live endpoints or delete the panels.
- **#28 target 0 is indistinguishable from unset.** 10 of 17 inputs read 0 and
  lose their "Current: … % of target" line; `steps` has unit `''` so the label
  renders `STEPS ()`. Needs a nullable target, not a 0 sentinel.
- **#23 mobile: only 5 of 9 destinations reachable.**
- **#26 dashboard frozen at mount in a long-lived tab** (no refetch on focus /
  visibilitychange).
- **#37 a deploy white-screens open tabs.** Renamed lazy chunk + the SPA
  catch-all serving `200 text/html` for a missing `/assets/*.js` → the dynamic
  import resolves to HTML and the whole app unmounts with no error boundary.
  Needs an error boundary + a reload-on-chunk-error, and the catch-all should 404
  for `/assets/*`.
- **#40 ActivityTab cards print one global `lastSynced` under hardcoded
  per-source labels** ("Withings: 08:48" when Withings' real time is 04:21). The
  server already returns `dataFreshness.byModule` — just consume it.
- **#41 a resolved sync error stays displayed for 24 h** next to the Reconnect
  CTA. Compare the issue timestamp against that module's last success.
- **#42 the read API silently substitutes defaults for invalid params**: unknown
  `granularity` → month branch, unknown `aggregation` → avg, bad dates → 365 d,
  `ai/insights?date=99999-99-99` → today. Validate values, not just presence;
  400 on bad input.
- **#29 85% of log volume is self-inflicted** — mostly per-row debug logging in
  ingest and cleanup. Needs a level gate, not deletions.
- **"Refresh Data" syncs nothing** — the handler is `clearUserCache` + `res.json`
  with no sync trigger at all.
- **#13 migrate `metrics.timestamp`, `workouts.timestamp`, `logs.timestamp` to
  `timestamptz`.** Drafting this migration is ideal cloud work: it must convert
  per-source (fact 1 above), must land before 2027-03-29, and needs the external
  healthsync writer (#19) pinned to one convention at the same time. Deliver the
  migration SQL + the read-path simplifications it enables; builder runs it
  against a backup first.

## Keep with builder (needs the host, the DB, or the live browser)

- **#38** — a leaked `error` listener per backpressured write in `writeChunk`
  (`server.ts:3579`). builder's own bug from the export fix; already in hand.
- **#19** — the undocumented external `healthsync` writer. Lives outside this
  repo, on Home Assistant.
- **#18** — needs the DB to settle which of the three disagreeing surfaces is
  right.
- **#21 BP widget** (15 readings, last real one 2026-09-17) and **#39** — both
  turn on what is actually in the tables.
- **#25 System Logs never loads on mount** — needs the live page to confirm the
  fetch-on-mount path is the only broken one.
- **#6** — reported as still reproducing; needs a live re-check against SQL.
- **#14 residue, #33, #34, #35** — awaiting Kieron's decisions.

## Verification standard

A patch is not done because it compiles. For each item state what you changed,
what a reviewer should see on screen or in the response body, and what you could
not check. builder will reproduce against the live instance and report back what
held and what didn't.
