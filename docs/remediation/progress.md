---
type: log
title: Vitality-hub remediation progress (2026-10-21 onwards)
description: Live tracker for Kieron's "work the list to completion without a go-ahead per item" instruction (Telegram, 2026-10-21 08:39, Tier 1). Numbering matches the outstanding list sent at 08:33. Detail for each fix goes in testing/vitality-24h-sweep.md; this file is the index.
tags: [vitality-hub, remediation, live]
---

# Vitality remediation progress

Numbering from the outstanding list sent to Kieron 2026-10-21 08:33.
Full per-item detail lives in `testing/vitality-24h-sweep.md`.

| # | item | status |
|---|---|---|
| — | /health-export unauth crash | DONE 07:25 |
| — | pre-auth 100 MB parse + global containment | DONE 07:28 |
| — | `/api/data/summary` strips `source` | DONE 07:45 |
| — | unauth login crash | DONE 07:48 |
| — | freshness badge read sync logs | DONE 08:40 (prev day numbering) |
| — | freshness +1h timezone regression | DONE 08:29 |
| 1 | `/api/targets` crash + silent garbage | DONE 08:40 |
| 2 | asyncHandler wrapper (24 unguarded handlers) | DONE (08:52) |
| 3 | `/api/export/all.json` 170 MB in memory | **DONE 10:05** — hand-rolled JSON streaming (keyset pagination, portable across the wrapper's 3 backends). 200 MB streamed with container at 172 MB RSS. Counts reconcile exactly vs SQL; body confirmed well-formed by a streaming grammar check. Also removed a real placeholder bomb: one SQL param per workout + per exercise, which Postgres rejects past 65,535. |
| 4 | `/api/export/metrics.csv` 97 MB | **DONE 10:05** — same streaming helper. 110 MB / 1,685,049 rows in 13.7 s, flat memory. Cursor keys on `(timestamp, id)` because `timestamp` alone is not unique in `metrics` — a timestamp-only cursor would skip rows. |
| 5 | rate limiter bypassable via X-Forwarded-For | **DONE 09:45** — `trust proxy` was `true` with no proxy in front; now env-driven, defaults off, `true` rejected. Verified 13 distinct XFF → one bucket (400×10 then 429). Also closes a latent unauth export bypass (gated off by unset env). |
| 6 | activity burn scored a day late | **DONE 10:20** — both copies (`calculateReadinessScoreServer` + `src/lib/readiness.ts`) built "yesterday" by reparsing a tz-formatted locale string as *process* local time, so the instant was off by (tz offset − process offset): container UTC vs Europe/London meant every local time from 23:00 under BST scored TODAY's partial burn as yesterday's strain. Now formats to Y-M-D then does `Date.UTC` arithmetic. Proven in-container: at 22:30Z old returns 2026-10-21, new returns 2026-10-20; January/GMT unaffected. Live endpoint reports 582 kcal = SQL total for 20/10 exactly (today 332). `getDateTimeInTimezone` uses the same API legitimately (offset cancels) — left alone. Pushed `5f8ed84`. |
| 7 | `filterMetricsByPriority` nondeterministic | **DONE 10:40** — worse than reported: the `candidates[0].source` fallback applied to *every* high-volume type (metric_priorities covers only 5 low-volume ones) and discarded other sources. Priority policy folded into the deterministic contender sort; `otherSources` provenance now populated (1,193 rows, previously always 0). |
| 8 | `/api/data/summary` LIMIT 1000000 silent loss | **DONE 10:40** — limit was being HIT: 1,668,607 rows vs 1M, oldest 40% dropped silently. Grouping moved into SQL (17,850 buckets, 94x). Verified: 16,802 agg rows reconcile exactly (16,649+153 sleep), values match SQL to last digit, 366-day coverage. |
| 9 | chart DAY/WEEK/MONTH sums wrongly | **DONE 11:35** — two defects: server applied `aggregation` twice (weekly total wearing the daily unit), and `processedData` had a `if (url) return` early exit so url-backed charts never grouped client-side at all (would have left Active Energy, Calorie Intake + all 18 ActivityTab charts stuck on day). Verified: all 12 rendered latest/avg values match in-page ground truth exactly. |
| 10 | summary cache key ignores date range | **DONE 10:10** — keyed on resolved window; `clearUserCache` clears all windows; found `endDate` was dead and implemented it; found+fixed my own ms-precision key defeating the cache. Verified live: 8650/1414/8650@63ms/1081. |
| 11 | `syncIssues` is last-bad-log, not sync status | DONE (09:22) |
| 12 | `syncIssues` 24h cutoff timezone | NOT A FAULT (09:22) — proven correct on live data |
| 13 | migrate 3 columns to `timestamptz` | todo (migration, not a hotfix) |
| 14 | deleting a user orphans health data | DONE (09:35) — orphan cleanup + FK constraints pending Kieron |
| 15 | startup cleanup writes cross users | **DONE 10:25** — two faults. (a) The cross-source nutrition cleanup's day subquery wasn't correlated on `user_id`, so one user's cronometer day deleted every user's apple_health nutrition for that date; now an `EXISTS` on (user_id, day), and set-based instead of SELECT-all-rows + inlined id list + whole-table debug log. (b) The sleep reclassification gated on a global `count(*) WHERE value > 50400` then ran a global UPDATE at the *lower* 43200 threshold, so one oversized row anywhere rewrote other accounts' 12–14h sleep rows; gate removed as redundant. Proven by rolled-back transaction: old predicate deletes 1, new deletes 0. Impact on current data was nil (user 1 covers every user-3 cronometer day) — latent, not realised. Pushed `9ca2281`. The flagged blanket purge (and this cross-source DELETE itself) were removed in #43 after Kieron's 10:25 decision — precedence moved to read time. |
| 16 | no daily review since 2026-10-17 | NOT A FAULT (08:58) — coach owns generation since 10-18 |
| 17 | configured Gemini model retired | DONE (09:10) — model set to gemini-flash-latest per Kieron |
| 18 | Apple Health dead, 3 places disagree | todo |
| 19 | `healthsync` undocumented third ingest | todo |
| 20 | HRV/readiness divergence | **DONE 10:45** — two causes, both now fixed. (a) The 63ms came from `healthsync` winning the day arbitrarily in `filterMetricsByPriority` (fixed in #43 — apple_health 47.8 vs healthsync 62.6 for the same day). (b) The residual hour: the summary SQL roll-up bucketed days as UTC (`AT TIME ZONE 'Europe/London'` on a column that is the identity for a London user), giving 47.82ms/70 rows where the charts had 48.22ms/83 rows — the 13 readings between 23:00 and midnight. Root cause is that `metrics.timestamp` holds a **different zone per source**: the five in-app modules `toISOString()` to UTC, `healthsync` (item 19, external writer) stamps London wall-clock, and `logs` takes `DEFAULT CURRENT_TIMESTAMP` in the London session zone. Bucketing and the two reading-freshness queries convert per source now; the logs queries keep London. Verified same-minute: coach 48ms / card 48.219 (83 rows) / chart 48.22, freshness apple_health 09:48 London and healthsync 10:40 London (3 min old). Pushed `5c6719b`. |
| 21 | BP widget 15 readings, last real 2026-09-17 | todo |
| 22 | SLEEP STAGES headlines measure different things | todo |
| 23 | mobile: 5 of 9 destinations reachable | todo |
| 24 | Nutrition Insights overflow <=390px | todo |
| 25 | System Logs never loads on mount | todo — confirmed live 09:25: mounts 0/0, one Refresh Logs click → 500/500; only fetch-on-mount is broken |
| 26 | dashboard frozen at mount in long-lived tab | todo |
| 27 | Debug Tools panels dead wiring | todo — **root-caused (pass 15)**: 2 orphan-file reads with no writer anywhere + `setDebugMetrics`/`setLastMetrics` never called; server endpoints work. Plus both panels have no dark: variants (2.43:1) |
| 28 | target 0 indistinguishable from unset | todo — quantified 09:25: 10 of 17 inputs read 0 and lose their "Current: … % of target" line; also `steps` unit is '' → label renders "STEPS ()" |
| 29 | 85% of log volume self-inflicted | todo |
| 33 | summed-metric merge policy | NEEDS KIERON (decision) |
| 43 | apple_health nutrition retention/precedence | **DONE 10:32** — Kieron decided (Telegram 10:25): keep the data, don't surface it when cronometer or a future nutrition source covers the day. Removed the blanket boot purge (all apple_health nutrition, all users, every boot) and the cross-source DELETE from #15 — precedence is a read concern. `filterMetricsByPriority` (charts, readiness, coach context) was still returning everything unfiltered for users with no `metric_priorities`, and otherwise falling back to `candidates[0].source`; it now shares the summary route's module-level SOURCE_RANK and ordering (user priority → SOURCE_RANK → row count → name). Verified live with synthetic rows on a covered day and a gap day: gap day shows apple_health, covered day shows cronometer with `otherSources {apple_health:1}`, no double count, rows survive a restart. Pushed `515a8d7`. **Caveat: apple_health nutrition was at 0 rows — history already purged, only new exports repopulate it.** |
| 34 | split 24h/72h staleness per module | NEEDS KIERON (decision) |
| 35 | Hevy webhook | NEEDS KIERON (their config) |
| 36 | No staleness signal for coach-owned insights (broken coach task shows a days-old review as current) | **DONE 09:55** — built to Kieron's 4 answers (alert-only, 36h, label engine, in-app schedule calls coach). `GET /api/ai/insights/freshness` + hourly watchdog + amber banner. Verified: endpoint against a genuinely stale state (42.13h), banner renders, real coach trigger fired end-to-end (coach wrote a new review 1 min later). Age query uses `now() AT TIME ZONE 'UTC'` — the column is naive but holds UTC. Banner copy now reports the actual trigger time (`coach_asked_at`) rather than claiming a trigger the 6h cooldown may have suppressed. |

Parked by Kieron 08:35 (not vitality): `nanoclaw-cleanup.service`,
`withings-precedence-fix-c977`, `poll-loop.ts` clamp tidy-up.

## New, found by sweep pass 16 (2026-10-21 10:30, task session bbba)

Not numbered into Kieron's 08:33 list — detail in `testing/vitality-24h-sweep.md`
under "sweep pass 16".

| item | status |
|---|---|
| 37 | deploy white-screens open tabs: renamed lazy chunk + SPA catch-all serves `200 text/html` for a missing `/assets/*.js`, no error boundary → whole app unmounts | todo |
| 38 | `writeChunk` (server.ts:3579) never removes the counterpart listener → one leaked `error` listener per backpressured write, live MaxListeners warning. **Bug in the 10:05 export fix.** Abort path itself tested clean | todo |
| 39 | `apple_workouts` freshness reads the apple_health *metrics* time (08:48) while its newest workout is 2026-10-13 — dead feed reads fresh. `MODULE_SOURCES` + max over both tables | todo |
| 40 | every ActivityTab card prints one global `lastSynced` under a hardcoded per-source label ("Withings: 08:48" vs Withings' real 04:21). Server already has `freshnessByModule` | todo |
| 41 | a resolved sync error stays displayed for 24 h next to the Reconnect CTA (Withings error 07:12, clean syncs 09:32 + 10:00) — compare the issue against the module's last success | todo |
| 44 | JS read paths still parse healthsync's naive timestamps as UTC (`new Date()`), shifting them +1h — `filterMetricsByPriority`, the chart route's own day grouping, readiness. Only changes a displayed value on a day no other source covers (healthsync loses precedence to apple_health). Real fix is one convention: #13 + #19 | todo |
| 42 | read API silently substitutes defaults for invalid params: unknown `granularity` → month branch, unknown `aggregation` → avg, bad dates → 365 d/now, `ai/insights?date=99999-99-99` → today. Validate values, not just presence | todo |
| 6 | activity burn a day late — still reproducing (pulse 582 kcal vs today's 331) | todo |
| 20 | HRV divergence now a 3-way spread in one viewport: coach 63ms / pulse 48ms / chart 47.8ms | todo |
| — | "Refresh Data" syncs nothing (handler is `clearUserCache` + `res.json`, zero log rows on click) — re-confirmed live | todo |
