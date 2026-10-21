# Remediation coordination

Two threads work this list. **Kieron set the split below on 2026-10-21 16:10
(Telegram, Tier 1); it supersedes any earlier division of labour in this file.**

## Ownership split (Kieron, 2026-10-21 16:10)

**cloud — the claude.ai project session "Vitality Hub" — is the primary
developer.** It owns:

- All application code: `server.ts`, migration SQL, and tests.
- Turning builder's findings into fixes. **builder does not write app code**,
  with two exceptions — an emergency hotfix and a rollback — and must tell
  Kieron when it uses either.
- The feature roadmap. Once the open bug queue **50–59** (all todo as of
  2026-10-21 16:20; **54** and **57** are IMPROVE) and cleanup **PR #22** land,
  it builds features in this order:
  1. HRV / resting-HR personal baselines
  2. Estimated 1RM and PRs
  3. Adaptive TDEE
  4. Day tags
  5. Phone alerts
  6. The rest of <https://claude.ai/artifact/BvnqazRXJJYEVrVRqEHrKZ>

**builder — the host/ops agent on `ser5` — is test, deploy and operations.** It
owns:

- Gating, merging, deploying and live-verifying every cloud PR
  (`vitality-pr-watch-6c6d`, exactly as described in the Protocol below).
- Anything needing the host: running migrations behind a backup, SQL ground
  truth, container and `kb-health` config, secrets, restarts, rollbacks.
- Sweeps and monitoring. **Report findings; do not fix them in code.**
- The tracker, except the row a cloud PR names (rule 3 below is unchanged).

### How builder feeds back

- Review objections, gate failures, test results and live verification go as
  **comments on the PR**. The cloud session sees those within moments; a relay
  through Kieron on Telegram is slow and lossy.
- A **new bug** becomes a tracker row with evidence — the query and its output,
  timings, a described screenshot — and the cloud session picks it up from
  there. builder does not open a fix branch for it.
- Say plainly what was verified and what could not be. A partial verification
  reported as complete is worse than an honest gap.

Everything else in this file (draft-claim protocol, one PR per item, the five
gates, the channel-of-record rule) is unchanged. **PR #22 has landed (`d7050ed6`, 16:34), so the
`tsc` gate baseline is now 0 errors — see gate 5 in the Protocol below.**

## Files

- [`progress.md`](progress.md) — **the tracker, and the single source of truth for
  item status.** Read it before picking up an item. Numbering comes from the
  outstanding list of 2026-10-21 08:33.
- [`handoff.md`](handoff.md) — context pack for a repo-only session: facts that
  cannot be derived from the code, the per-item root causes already found, and
  which items belong to which thread.

Fuller per-item detail (live measurements, verification transcripts) lives in
builder's workspace at `testing/vitality-24h-sweep.md` — not in this repo. Ask for
an extract if an item needs it.

## Protocol

1. **Claim an item** by opening a *draft* PR straight away, before writing code:
   branch `fix/item-<n>-<slug>`, title starting `item <n>:`. That is how the other
   thread sees the item is taken. An item with an open PR is claimed.
2. **One PR per item.** Only touch `server.ts` if the item names it, and then
   only **one open branch at a time** across all threads — it is a single
   ~3600-line file and two concurrent branches in it cost a hand-resolved merge
   twice already (#6 vs #3, #9 vs builder's item-44 work).
   **`server.ts` is free as of 2026-10-21 12:49.** builder released it at 11:49
   (item 44, merged `64daba6`) and all three cloud items in that file have since
   landed, in order and one PR at a time: **42** param validation (merged
   `c143e19`), **29** log level gate (merged `b55eee5`), **Refresh Data** really
   triggering a sync (PR #14, merged `69c8865`). Nothing holds the file now, so
   claim it the normal way — open the draft PR first, and tell builder, which may
   have taken it back for a host-side item by then.
   **Review, merge, deploy and live verification of every cloud PR belong to the
   `vitality-pr-watch-6c6d` task on ser5** (polls open PRs every 5 minutes, skips
   drafts). No thread hand-merges, and a PR sitting open for a few minutes is the
   queue working, not a stall.
3. **You own your own item's row in `progress.md`; builder owns everything else
   in it.** (Revised 2026-10-21 13:30 — the original rule was "only builder edits
   it", which is why four items still read "NEEDS KIERON" an hour after Kieron had
   answered them and he got a wrong status report.) Edit *only* the row for the
   item your PR names, in the same PR as the code, and leave every other line
   untouched: distinct rows are distinct lines, so they merge cleanly. builder
   still adds the merge sha and the live-verification result after deploy, and
   still owns the loose-threads section and any row you did not claim.
   **Both sides: edit from `main`'s blob, never from a whole-file mirror.** The tracker clobber today (`b888314`) was a stale copy of the file
   written over the top of newer rows — including a sibling session's; it
   reverted items 14/33/35 and dropped the loose-threads section, and
   `49f562c` / `7af035f` were the restorations, not the damage. A
   whole-file overwrite of `progress.md` is the one edit that is never correct. That still stands — a cloud thread editing the
   tracker inside a feature PR would collide with every other open PR and with
   builder's own mirror. What changed on 2026-10-21 13:25 is **who is late**: the
   same-session recording duty is builder's, not yours. Any builder session that
   decides something, lands something, or is told something by Kieron writes it
   into this file in that same session — the tracker ran two reports stale that
   afternoon and Kieron was told four items were still waiting on him an hour
   after he had answered them.
   When you do write it, patch the single row against the blob of the current
   `main`, never mirror the whole file from the shared `/opt/build/vitality-hub`
   clone: `b888314` did that from a stale copy and reverted items 14/33/35 plus the
   Loose threads section, and `49f562c` had to restore them. Several builder
   sessions edit this file at once.
4. **PR body states** what changed, what a reviewer should see on screen or in the
   response body, and what you could not check.
5. builder runs five gates before merging: the diff stays in scope for the named
   item; `npx tsc --noEmit` is **completely clean, zero errors** — the old
   allowance for the two known pre-existing errors is **revoked** as of PR #22
   (`d7050ed6`, merged 16:34), which fixed both; builder verified `tsc --noEmit`
   exit 0 on that tip at 16:36, and `vitality-pr-watch`'s gate prompt was updated
   to match, so any `tsc` error at all now fails the gate;
   `npx vitest run` is green (baseline re-measured on `d7050ed6` 2026-10-21 16:36: **18 files, 266 tests, 3.9 s**;
   the earlier "5 files, 60 tests, 1.3 s" figure is stale — the suite has grown — pass
   no `--reporter=basic`, it was removed in vitest 4); no DELETE of `apple_health`
   nutrition rows is reintroduced; no blanket `AT TIME ZONE` is applied to
   `metrics`/`workouts` (those columns hold a different zone per source — see
   `handoff.md`). A failed gate gets a comment on the PR, not a merge.
6. **Unit tests are welcome and are the only check you can run yourself.** The
   suite is `vitest`, co-located `*.test.ts`. An item whose fix is a pure function
   (date arithmetic, source precedence, param validation) should come with a test
   that fails before the change — that is worth more than a described repro,
   because builder can run it without a browser.

## Channel of record (Kieron, 2026-10-21 11:46)

builder can currently drive the claude.ai tab directly from the host, and that
access **will be revoked**. It is a convenience layer only — the coordination
state must survive losing it. So:

- These three files on `main` are the channel of record. Anything a thread needs
  in order to continue — item status, who holds what, why something was blocked,
  what the next step is — belongs here, not only in a claude.ai thread or in
  builder's workspace.
- builder mirrors the tracker to `progress.md` and pushes in the same working
  session as any status change, not on a later sweep. A status that exists only
  in a transcript is treated as unrecorded.
- A blocked or rejected PR gets its reason as a **PR comment** as well as a
  tracker line, so the owning thread can read it without a relay.
- Once direct access is gone, this reverts to exactly the asynchronous protocol
  above: claim by draft PR, status in the PR body, builder merges and records.
  Nothing in that loop depends on a shared browser.

## Log

- **2026-10-21 16:18 (builder → cloud, in-thread, mirrored here because the
  thread is not the channel of record).** The 14:09 Telegram work hold expired at
  16:15; work resumed. builder corrected the feature gate above: the README as
  first written gated the roadmap on "items 50–53, 55", but the tracker's open
  queue is **50–59**. **Item 59 is a security row** — `POST /api/logs`
  (`server.ts:4341`) validates only that `level`/`message`/`source` are truthy, so
  any authenticated user can forge system log entries — and **58** crashes a
  whole route to the error boundary on a non-2xx from `/api/metrics/aggregated`.
  Those two go first. The cloud session accepted and sequenced the work: item 50
  (already half done and holding `server.ts`) finishes first, then 59 and the
  remaining `server.ts` items one branch at a time; 55 and the non-server items,
  starting with 58, run in a second thread; PR #22 is being marked ready.
  PRs **#20** (item 55), **#21** (item 50) and **#22** (cleanup) were all still
  *drafts* at 16:18, so the watcher had recorded them only as item claims — a
  draft is never gated, merged or deployed.

- **2026-10-21 16:36 (builder, host-verified).** Clearing of the merge backlog
  confirmed on `main` at `d7050ed6`: items **50** (`b6306e33`, PR #21), **55**
  (`e009c1fc`, PR #20) and **58** (`d98b07e4`, PR #23) merged, and cleanup **PR
  #22** merged as `d7050ed6`. On that tip, measured on the deploy host:
  **`npx tsc --noEmit` exit 0, zero errors** and **`npx vitest run` 18 files /
  266 tests, all passing, 3.9 s**. Both figures are the new gate baseline and
  `vitality-pr-watch`'s prompt now enforces zero `tsc` errors rather than the
  two-error allowance — a stale allowance would have let two fresh errors through
  unnoticed. Item 58 landed on its own branch (`fix/item-58-chart-non-2xx`) rather
  than being folded into PR #20, which is what kept #20 inside its scope gate.
  Still open at that moment: **#24** `fix/item-56-admin-one-way-door` and **#25**
  `fix/item-57-ai-insights-overflow`. Items **51, 52, 53, 54, 59, 60** remain
  unclaimed, with **59** (forgeable system log entries) the only security row
  among them.
