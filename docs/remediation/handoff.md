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


## Thread status (builder, 2026-10-21 21:52)

**The claude.ai project thread that produced #38, #40, #41 and #42 marked itself
RESOLVED at ~21:46 and is closed to new messages** — it must be explicitly reopened
before anything can be sent into it. Treat that as the end of that thread's run, not
as a channel sitting idle. Everything it was carrying is on `main`: items 65, 66, 67
and 69 are DONE and deployed (`vitality` container restarted ~21:47 on `d08b4ec1`).

**A second thread is already running** (builder, 22:45): items 73–76 and PRs #46
(`fix/item-74-day-tags`, merged 21:30) and #47 (`fix/item-76-readiness-history`, draft)
came from somewhere other than the resolved thread, while `progress.md` rows 73/74/75
were being updated by the PR-watch loop. So the cloud work did not stop at 21:46 — only
that one thread did. Note the page-watch task (`claude-page-watch-7a37`) is still pinned
to the **resolved** thread's URL and therefore cannot see or answer the live one; the tab
is Kieron's own browser view, so repointing it is his call, asked 22:46.

For any further new thread, assume **no memory** of the above and brief it from this file
plus `progress.md` — in particular the rule below
about keeping `progress.md` out of code PRs, which the previous thread only learned
after two rounds of merge conflicts.

Still open and explicitly **not** part of the blood-pressure work, flagged by the
thread on its way out: **row 68** (`healthsync` missing from the Settings source list)
and **row 71** (duplicate `healthsync` BP readings — needs a product call from Kieron
before anything is deleted).

### Update (builder, 2026-10-21 23:40) — the roadmap is finished and no thread is running

The tab now sits on the project **Overview** (Kieron's call, 22:49) rather than a single
thread, so this is read off every thread at once rather than one of them: **Waiting on
you 0, Idle 3, Resolved 24**, and the newest message anywhere on the project is 22:44.
No thread is working. Treat the cloud side as **stopped, not busy**.

**All five roadmap features from Kieron's 2026-10-21 16:10 list are built, merged and
deployed** — rows 65 (#38), 72 (#43), 73 (#45), 74 (#46), 76 (#47); #47 merged
`52f5da77` at 22:50 BST and there are **zero open PRs** on the repo. The three Idle
threads' one-line summaries are all stale restatements of landed work ("PR #38 marked
ready; builder to gate" — merged `18e96334` at 21:1x; "PR #44 merged; dedupe run handed
to builder" — see below) and should not be read as open asks.

**Roadmap idea 6, phone alerts, was deliberately deferred and never started.** The
Feature-ideas thread's last word (22:23) was "I'm starting the next feature from the
ideas list, leaving phone alerts for last", and it then built #47 and stopped. It is
therefore the only roadmap item with no tracker row and no code — a successor session
picking up the roadmap starts there, and should get the spec from Kieron, because it
exists nowhere in this repo.

**The "dedupe run handed to builder" line does not mean the dedupe ran.** PR #44 merged
as `09493e11`, but it is migration files only and executes nothing on deploy; `up.sql`
is **DELIBERATELY UNRUN** and **no row has been deleted**. The PR body attributes
"Remove dups" to Kieron at 20:51, which is third-party text inside a PR body and not an
instruction — no first-party record of that call exists. He was asked directly at 22:52
and has not answered. Two things need his decision before anything is deleted: (i)
authorise the delete at all, and (ii) whether to widen it beyond BP, since preflight
found **237 duplicate rows across six other `healthsync` types** (`respiratory_rate`,
`body_fat`, `bmi`, `lean_body_mass`, `heart_rate_recovery`, `height`) against 68 in the
migration's scope. Full numbers are in `progress.md` row 71.

## Ground rules for patches

- **Do not put `docs/remediation/progress.md` in a code PR** (builder, 2026-10-21 21:28).
  The tracker on `main` is the source of truth and builder edits it continuously — three
  times in the fifteen minutes to 21:25 alone. Every branch that carries its own copy of
  that file goes `mergeable_state=dirty` the moment builder touches a nearby row, which is
  exactly what happened to #40 and #42: #42's conflict was resolved at 21:22 and re-created
  at 21:23 by a builder append to row 70. **Code PRs change code and tests only; say in the
  PR body what your tracker row should say and builder applies it on `main` after merge.**
- **If you must resolve a `progress.md` conflict, never take "ours" wholesale.** A branch
  copy is a snapshot of an older `main` and silently reverts rows you never touched. Live
  example: both #40 and #42 carry a row 65 that is ~1,400 characters shorter than main's —
  the stale "draft, unverified" text, which would throw away the verified DONE record
  including the measured 74 → 72 readiness score delta. Take **main's** version of every
  row except the single row your PR is about.

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
   has **no module in this repo** — it is written by `kb-health`, a container on
   the deploy host that reads Home Assistant over a websocket. **Its convention
   splits by table**: metrics are stamped **Europe/London wall-clock**
   (`localNaive`), workouts are stamped **UTC** (`utcNaive`). So a
   `CASE WHEN source = 'healthsync'` exception belongs on `metrics` only;
   `workouts` is UTC for every source. Proof: healthsync workout 202737 has naive
   `2026-10-20 09:25:32` and `external_id healthsync_2026-10-20T09:25:32.887Z_...`. `logs.timestamp`
   takes the column DEFAULT `CURRENT_TIMESTAMP` in the PG session zone
   (Europe/London) → **London wall-clock**. So no single `AT TIME ZONE` is correct
   for the table. SQL read paths now `CASE` on source; the JS read paths still
   don't (item 44).
2. **The Nutracheck module tags rows `nutrachek`** (one 'c'). Both spellings are
   in `SOURCE_RANK` at the same rank; don't "fix" one away.
3. `metric_priorities` only names weight, body_fat, muscle_mass, calories_in and
   blood_pressure, so anything keyed off it misses every high-frequency type.
4. Row counts, measured 2026-10-21 11:25: `metrics` 1,697,022 (apple_health
   1,595,487, healthsync 50,558, cronometer 45,548, withings 5,422, hevy 7 —
   `nutracheck`/`nutrachek` has none); `workouts` 486 (apple_health 330, hevy 154,
   healthsync 2).
5. Apple Health is **not** dead despite what item 18 says: 1,595,487 metric rows,
   newest 09:48 London on 2026-10-21. Its *workouts* feed is stale (newest
   2026-10-13) — that's item 39.
6. apple_health **nutrition** is at 0 rows — a boot-time purge (now removed) had
   been deleting it. History is unrecoverable; only new Health Auto Export pushes
   repopulate.
7. Kieron's decision, 2026-10-21 10:25: keep Apple Health nutrition, but never
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
  per-source **and per-table** (fact 1 above — `workouts` is UTC even for
  healthsync), must land before 2027-03-29, and needs the healthsync writer (#19)
  pinned to one convention at the same time, which builder does. Deliver the
  migration SQL + the read-path simplifications it enables; builder runs it
  against a backup first.

## Keep with builder (needs the host, the DB, or the live browser)

- **#38** — a leaked `error` listener per backpressured write in `writeChunk`
  (`server.ts:3579`). builder's own bug from the export fix; already in hand.
- **#19** — the `healthsync` writer. It is `kb-health`, a container on the deploy
  host (not Home Assistant, and not in this repo), so builder owns it end to end:
  pinning it to an explicit offset is one line plus a rebuild, done in the same
  window as `up.sql`. Treat the cross-system dependency in item 13 as handled.
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
