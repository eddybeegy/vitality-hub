# Remediation coordination

Two threads work this list. **Kieron set the split below on 2026-10-21 16:10
(Telegram, Tier 1); it supersedes any earlier division of labour in this file.**

## Ownership change (Kieron, 2026-10-22 06:30): builder is now the primary developer

**Kieron handed all development back to builder "until I say otherwise".** From
2026-10-22 06:30 **builder owns everything**: application code (`server.ts`,
migration SQL, tests, features) as well as test, deploy and operations. The cloud
project session has stood down and starts no new work. The 2026-10-21 16:10 split
below is kept for history and **no longer applies** while this change stands.

**Kieron may hand work back to the cloud project later.** A cloud session starts
with no memory beyond this repo. So, while builder holds development:

- Keep `README.md` (this file), `handoff.md` and `progress.md` current enough
  that a fresh developer could resume from them alone. That means: open PRs and
  their state, the next roadmap item, any half-built branch, and every rule
  learned the hard way.
- The working rules still hold for builder's own code: one item per branch/PR
  (`fix/item-<n>-<slug>`, title `item <n>: ...`), never two open branches touching
  `server.ts`, and the five gates (tsc zero errors, vitest green, no nutrition
  DELETE, no bare `AT TIME ZONE`, portable SQL).
- The full handover (open PRs, the remaining roadmap in order, the half-built
  item 90 branch, and known traps) is at the top of [`handoff.md`](handoff.md).

## Ownership split (Kieron, 2026-10-21 16:10) — superseded 2026-10-22 06:30, see above

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

- **2026-10-21 16:41 (builder).** A cloud worker thread sat idle with the status
  "waiting on builder's gate results for #24 and #25". **Do not block on a gate
  result.** `vitality-pr-watch` fires every 5 minutes and picks up any READY,
  unhandled PR on its own; builder comes to you with objections as PR comments,
  so **silence from builder is not a verdict** — keep claiming and pushing the
  next item while a PR waits. Host state at that moment, for anyone reading this
  after browser access is revoked: `main` at `21a9c7f1`, ser5 working tree clean,
  item **50** live-verified against Postgres and done. A deploy was **in flight**
  — `vitality-hub:latest` was rebuilt at 16:40:43 while the running container was
  still the 16:31:59 one, so the live app carried items 50, 55 and 58 but not yet
  the **#22** cleanup. Two consequences worth knowing generally: a live check run
  in the minutes after a merge can read stale, and the merges of **#20, #21, #22,
  #23** happened outside the `vitality-pr-watch` loop (its own log for that window
  reads "nothing merged", and `testing/.pr-seen` held only their pre-merge draft
  shas until builder reconciled it at 16:41). If a tracker row and that task's log
  disagree about who gated a PR, the repo and the merge commit win.

- **2026-10-21 16:52 (builder).** Two ready PRs were claiming items that had no
  tracker row, which leaves `vitality-pr-watch-6c6d`'s scope gate nothing to match
  a diff against. Numbers assigned and rows written here, not left in the thread:
  **item 61** = the remaining `response.ok` audit (PR #28, row `61d8d00b`) and
  **item 62** = settings saved after a failed load overwriting the real row with
  defaults (PR #29, row `5a26506b`, the number the PR body asked for). Both PRs
  were asked — on the PR and in-thread — to retitle to `item <n>: ...`; neither
  should add or edit a tracker row itself. **Measured correction to item 58's row:**
  it says "19 `fetch('/api/...')` sites / the other 18". On `main` at 16:50 there are
  **48** such call sites across 12 files, **15** of them with no `.ok` check — the
  list is in row 61 and is the scope #28 should keep to. Item **59** merged
  `29ff33d5` 16:49 by the watcher; **#27/#28/#29** are open and all three will
  re-wake it, so nothing is stuck and no thread should hold for a gate from a
  builder session.

- **2026-10-21 16:57 (builder).** PR #32 asked builder to confirm a deploy-time
  precondition, which is the one class of question a cloud thread genuinely cannot
  answer itself. Answered on the PR and in-thread, and recorded as **item 63**
  (row `c97a12c7`): `docker-compose.yml:12` is
  `JWT_SECRET=${JWT_SECRET:-<committed default>}`, so any deployment started without a
  populated `.env` signs tokens with a value that is public in the repo. **Verified on
  ser5 16:56 — removing the fallback is safe:** `/opt/build/vitality-hub/.env` sets
  `JWT_SECRET` (43 chars), the running `vitality` container carries exactly one
  `JWT_SECRET` line of the same length (so it is not using the default today), and that
  directory is the compose project working dir, so a bare or `:?` form resolves
  identically. `.env` is gitignored. Live sessions unaffected; only the unset-env path
  changes, from a public default to a hard start failure. The PR was told not to put the
  value or a realistic sample in the diff.
  Status corrections pushed back to the thread, whose dashboard was stale: **#25**
  merged `ddc8c426`, **#28** merged `6755c676` (item 61), **#29** merged `0ae66a2d`
  (item 62) — all three after the retitles asked for at 16:52. Open at 16:57: **#30**
  (item 51) READY, **#31** (item 61 continuation) READY, **#32** still draft.

- **2026-10-21 17:01 (builder, queue state — no action was needed on the thread).**
  Four PRs open and all four READY: **#30** item 51 (`server.ts` +9, the `/api/*`
  404), **#31** item 61 continuation (sign-out and client log shipping), **#32** item
  63 (retitled and marked ready after the 16:56 host confirmation), **#33** item 60
  second half. None is in `testing/.pr-seen`, so `vitality-pr-watch-6c6d` picks up all
  four on its 17:00 fire; its last 29 runs show 0 failures. Nothing is stuck and no
  thread should hold for a gate.
  Two things a thread reading the tracker would otherwise get wrong:
  **(1) item 60 has two PRs.** #27 (`normaliseLogLevel` in `src/lib/logLevel.ts`)
  merged `654cdec8` at 16:50; row 60 still reads "PR #27 ready for gate" because the
  merge happened outside the pr-watch loop. #33 is the second half and touches
  `src/lib/logEntry.ts`, not `server.ts`, despite its title naming `POST /api/logs`.
  The two diffs do not overlap.
  **(2) #30 is the only branch holding `server.ts`.** Do not open a second one until
  it lands — that is the one-branch-at-a-time rule, and #30 is the branch that holds
  it. #33's title reads like a `server.ts` change and is not one.
  Rows 51 and 60 were deliberately **not** edited here: each is carried as a +1/-1 in
  its own open PR, and editing the same line from `main` would turn that PR's
  `mergeable_state` dirty and block the gate. The owning PR updates its row on merge.

- **2026-10-21 17:06 (builder) — gate baseline re-measured; gate 5 figures below are
  superseded.** On `main` tip `9276893`, after #30/#31/#32/#33 were merged in a batch at
  17:01–17:02 and deployed (image built 17:02:53, container restarted 17:03:05):
  **`npx tsc --noEmit` exit 0, and `npx vitest run` is 22 files / 314 tests, all
  passing, 3.9 s.** The old 18 files / 266 tests figure is retired, and
  `vitality-pr-watch-6c6d`'s prompt has been updated to the new one — a stale baseline
  fails *permissively*, which is how two fresh `tsc` errors could have slipped through
  earlier today.
  For the record, that batch was merged and deployed outside the pr-watch loop (its
  last run log is 16:23 and its next fire was 17:10), the same pattern as #20–#23. The
  sibling session that did it recorded rows 51 and 59–63 DONE with merge shas and live
  verification in `9276893`, so nothing was left stranded — but **if a tracker row and
  a task's run log disagree about who gated a PR, the repo and the merge commit win.**
  Host state at 17:06: working tree clean apart from untracked `data/`, local `HEAD` ==
  `origin/main`, container running.

- **2026-10-21 17:12 (builder) — the "failing review check" is a timeout, gates
  nothing, and must not be switched off.** A thread was about to ask Kieron for
  permission to disable it; that question is unnecessary. Diagnosis from the Actions
  API:
  - The check is **Gemini Review**, run as the `review` job inside
    `.github/workflows/gemini-dispatch.yml`.
  - Across **34** `pull_request` dispatch runs: **33 cancelled, 1 in flight, zero
    successes, zero failures.** It has never once produced a review.
  - Cause: `gemini-review.yml` sets `timeout-minutes: 7` and the "Run Gemini pull
    request review" step hangs until it hits that timeout, which GitHub reports as
    **cancelled, not failure**. On #33 the step ran 15:55:36→16:03:14 UTC (7m38s).
  - Why it hangs: `Mint identity token` is skipped because the repo has **zero Actions
    variables**, so `GCP_WIF_PROVIDER` / `GOOGLE_CLOUD_PROJECT` /
    `SERVICE_ACCOUNT_EMAIL` are unset and auth falls back to the `GEMINI_API_KEY`
    secret, last rotated **2026-05-22**. A stale key gives exactly this shape — a hang
    with no fast-fail.
  - **It gates nothing.** `main` has no branch protection (the protection endpoint
    404s, `protected: false`), so there are no required status checks and a timed-out
    review cannot block a merge. Repo CI (`ci.yml`) is separate and was green on #34.
  Standing position: treat it as cosmetic noise and keep merging. **No thread should
  edit or disable that workflow** — turning off a review control and rotating the
  Gemini credential both need Kieron on his own channel, and neither is needed to
  unblock anything today.
- **2026-10-21 17:16 (builder).** Queue state: **zero open PRs on the repo**, so
  `server.ts` is held by nobody — claim it the normal way, draft PR first. Item **52**
  is not "in review" as the thread dashboard still read at 17:12: PR #34 merged
  `bef048c0` 16:11 UTC, container recreated 16:12:15, and builder live-verified at
  17:14 that a trailing comma, a truncated body and a non-JSON body all answer **400
  `application/json`** with a position-carrying error where all three were 500 — row 52
  is DONE with that evidence (`60b44b5`). Remaining server queue, one branch at a time:
  **64** (row already on `main`, `f5910cb6` — `logEvent` escapes control characters for
  the file sink but stores the raw message in the `logs` table; marked OPEN for the
  server thread), then **53**, then **54** (IMPROVE). All front-end items and the
  `JWT_SECRET` compose fix (#32, `e6bcca54`) are merged and live.
- **2026-10-21 17:16 (builder) — the Gemini review workflow.** A thread now reports it
  has a *tested* fix for the hang (the review extension install asks a second prompt
  that is never answered, so a key rotation alone would not fix it) and offered it as "a
  small workflow change". **Nothing has touched `.github/workflows` since `d7050ed6`
  (15:34), and that is the correct state — do not land it.** Changing or disabling a
  review control needs Kieron's explicit OK on his own channel; if he wants it, it goes
  in as its own PR with its own tracker row, never folded into a queue item. The
  check still gates nothing (`main` unprotected, no required status checks), so this
  blocks no work either way. Root cause record: `3fc8d974`.
- **2026-10-21 17:20 (builder).** Item **64 is claimed**: PR **#35**
  (`fix/item-64-log-db-escape`) opened 17:16, **ready, not draft**, and sitting in the
  `vitality-pr-watch-6c6d` queue — the watcher's gate sees it as unhandled and its next
  fire was due 17:20, so it is queued, not stuck. Nobody hand-merges it. **#35 carries
  the row-64 tracker edit itself (+1/-1), so no builder session may touch row 64 from
  `main` while it is open** — that is exactly the edit that turns a PR's
  `mergeable_state` dirty and blocks its own gate. It touches `server.ts`, so
  `server.ts` is held until #35 lands; items 53 and 54 wait their turn, one branch at a
  time. The cloud session confirmed in-thread at 17:19 that it accepted the item-52
  correction and that the Gemini workflow stays untouched unless Kieron asks for it as
  its own item.
- **2026-10-21 17:26 (builder).** Item **64 landed** — PR #35 merged `03e37df9`, gated on
  head `4bd297b0` (`tsc --noEmit` exit 0, vitest **23 files / 326 tests** green),
  deployed and live-verified by the `vitality-pr-watch-6c6d` pass at 17:25; ser5
  `HEAD == origin/main == efd3376`, container healthy. Row 64 is DONE in the tracker.
  **Zero open PRs, so `server.ts` is free again.** Next in the server queue: **53**
  (`GET /api/logs` accepts no `limit`/`level`/`source`/`date` and `readFileSync`s the
  whole current-day log file per request, `server.ts:4373`, with the indexed table
  unused), then **54** (unbounded 109.7 MB metrics CSV export, IMPROVE). Both rows carry
  their evidence already. Claim 53 the normal way — draft PR first — and it holds
  `server.ts` alone until it lands. The thread card read "#35 waiting on builder's gate"
  after the gate had already passed; corrected in-thread at 17:26.
- **2026-10-21 17:30 (builder).** Item **53 is claimed**: PR **#36**
  (`fix/item-53-logs-query`, head `31b380a8`) opened 17:25, **ready, not draft**, and
  unhandled in the `vitality-pr-watch-6c6d` gate — that task's next fire was due 17:30,
  so it is queued, not stuck, and nobody hand-merges it. It touches `server.ts`
  (+56/-31) plus a new `src/lib/logsQuery.ts` and its test, and `DebugTab.tsx`, so
  **`server.ts` is held until #36 lands**; item 54 waits. As with #35, **#36 carries its
  own tracker edit (`progress.md` +1/-1), so no builder session may touch row 53 from
  `main` while it is open** — that edit is what turns a PR dirty and blocks its own
  gate. Thread status "Item 53 in PR #36 for review; item 54 after merge" is accurate;
  nothing needed correcting this pass.
- **2026-10-21 17:37 (builder).** Item **53 landed** — PR #36 merged `7b550dc5`,
  deployed and live-verified by the `vitality-pr-watch-6c6d` pass; ser5
  `HEAD == origin/main == 70040e9`, row 53 DONE. App healthy on the deployed build: the
  root answers **200**, and `/api/health` and `/api/logs` answer **401 Unauthorized**
  unauthenticated — that is the expected shape, not a regression (noted because a probe
  of port **3001** returns 404 from NanoClaw's webhook server; the app is on **3000**).
  **Zero open PRs, `server.ts` free.** **Item 54 is the last item in the queue** — the
  unbounded `/api/export/metrics.csv`, no date range and no row cap, all 1.69M rows at
  109.7 MB and growing. It is **IMPROVE, not a correctness bug**: streaming and
  `no-store` are already verified and the item-38 `writeChunk` listener fix held across
  a full 110 MB export with no MaxListeners warning, so neither needs re-litigating.
  Claim it draft-PR-first on `fix/item-54-export-bounds`. After it lands the queue is
  empty and the roadmap features begin in Kieron's order: HRV/resting-HR baselines,
  estimated 1RM and PRs, adaptive TDEE, day tags, phone alerts.
- **2026-10-21 17:41 (builder) — item 54 claimed, and what "fixed" means for it.** PR
  **#37** (`fix/item-54-metrics-csv-range`, head `e83a5704`) opened 17:35, **ready, not
  draft**, 4 files: `server.ts` +30/-6, new `src/lib/exportWindow.ts` (+83) and its test
  (+88), and the row-54 tracker edit (+1/-1) — **so row 54 must not be touched from
  `main` while #37 is open.** Queued for `vitality-pr-watch-6c6d` (not in its handled
  list; next fire 17:45), not stuck.
  **Design decision, accepted by builder and recorded here because it changes the
  meaning of the row:** `/api/export/metrics.csv` gains *optional* `start`/`end` dates,
  and with no arguments it **still streams the full export, deliberately**, so nothing
  is silently dropped. Item 54 is **IMPROVE**, not a correctness bug, and none of the
  five gates has an opinion on the default window — a backup export that silently capped
  itself would be worse than a large one. Do not read item 54 as "the export is now
  capped"; it is "the export can now be bounded on request".
  After #37 lands the remediation queue is empty and the roadmap starts with HRV /
  resting-HR personal baselines for readiness.
- **2026-10-21 17:48 (builder) — item 54 landed; the queue is clear but not empty.** PR
  #37 merged `bf1dd947`, ser5 `HEAD == origin/main == bf1dd94`, container healthy (root
  **200**, export endpoint **401** unauthenticated as expected). **Zero open PRs,
  `server.ts` free.** All 50–64 remediation items are now DONE or closed as NOT A FAULT.
  **Two real residuals were still unclaimable, and are now rows 65 and 66** (`7e97cf7a`),
  carved out of row **21** — they had been sitting inside a row headed *PREMISE STALE*,
  so no thread could claim them, while the stale part (the BP widget stuck at 15
  readings, last real 2026-09-17) had genuinely been fixed as a side effect of items
  7/8/48:
  - **65** — one BP reading can resolve to **two different devices**: priority resolves
    per (day, type) and systolic/diastolic are separate types, so **6 of 40 displayed
    readings pair a `withings` systolic with an `apple_health` diastolic** (2025-12-09
    122/74, 2025-12-15 126/75, 2026-03-09 117/75, 2026-03-23 108/65, 2026-03-31 115/69,
    2026-04-09 112/72). Both halves are plausible, so it renders as a normal reading and
    nothing flags it. BP should resolve as one unit.
  - **66** — the `blood_pressure` metric-priority key is **dead config**:
    `MetricSettings.tsx:45` offers it but `filterMetricsByPriority` does an exact
    `priorities[type]` lookup against `blood_pressure_systolic`/`_diastolic`, so the
    entry in Kieron's live `metric_priorities` has never had any effect.
  Both are **OPEN for the cloud session**, to claim draft-PR-first as normal.
  The Gemini bot comment on #37 is the **dispatch acknowledgement**, not a review — the
  review job has still never completed once; the thread is right to treat it as noise.
  Roadmap now starting: HRV / resting-HR personal baselines. The thread's proposed
  design (compare HRV and resting HR against a 28-day personal normal range, shown as
  e.g. "52ms · normal 44-60", resting HR also joining the score) is **its own call plus
  Kieron's preference on weights and window** — builder has no view, and it blocks
  nothing; he can answer in his own time.

- **2026-10-21 17:56 (builder).** **Roadmap feature 1 is tracker item 65**, confirming the
  number the cloud session had already taken on `main` in `33418bf7`; PR **#38**
  (`claude/project-thread-milvhq`) carries it and **is still a draft**, so
  `vitality-pr-watch-6c6d` skips it and nothing is gated, merged or deployed yet. #38 holds
  `server.ts` and is the only branch in that file. It does **not** touch `progress.md` — row
  65 went in as a direct commit — so the tracker is free for builder rows alongside it.
  **A builder whole-file write clobbered two rows and this is the record of it.** `7e97cf7a`
  (17:46) added rows 65 and 66 for the blood-pressure residuals carved out of row 21;
  `b0dc9c84` (17:47, "mark item 54 DONE") was built from a copy of the file that predated
  them and pushed back `+1/-3` — row 54 updated, rows 65 and 66 **deleted**. The sha matched
  because the two writes were seconds apart, so the Contents API had nothing to 409 on: a
  correct sha does not make a whole-file body safe, only a row-wise patch does. Rule 3 above
  says exactly this and a builder session did it anyway. Restored in `6dc00b7b` as rows
  **66** (one BP reading resolving to two devices — 6 of the 40 displayed readings pair a
  `withings` systolic with an `apple_health` diastolic) and **67** (the `blood_pressure`
  metric-priority key is dead config), evidence unchanged, with the renumber noted in row 66
  itself. **65 stays with the feature.** The cloud session's "Blood pressure source pairing"
  thread was told in-thread (verified landed) that its items are 66/67, not 65/66.

- **2026-10-21 17:58 (builder).** The BP thread picked the renumber up within a minute and
  re-claimed correctly: **PR #40** `fix/item-66-bp-one-source` is the live claim on item 66,
  rebased on `6dc00b7` and editing **only row 66's status cell**. **PR #39** is the same work
  under the old number and is superseded — builder asked on the PR for it to be closed, and
  it must be: its `progress.md` patch is `+1/-0` adding a *new* row 65, which on `main` is now
  roadmap feature 1, so if #39 ever went ready it would duplicate 65 and fail the scope gate.
  Both #39 and #40 are drafts, so `vitality-pr-watch-6c6d` skips them and builder has gated
  nothing. #40 deliberately holds its `server.ts` half until **#38** merges, keeping one open
  branch in that file — that sequencing is correct and builder is not overriding it. Item
  **67** (the dead `blood_pressure` priority key) is still unclaimed.

- **2026-10-21 18:04 (builder).** **PR #39 is closed** and the BP work is now #40 (item 66) and
  **#41 (item 67)**, both drafts. **#41's base is `fix/item-66-bp-one-source`, not `main`** —
  it is a stacked PR and the thread plans to retarget it after #40 merges. Any builder session
  or `vitality-pr-watch-6c6d` pass that sees #41 go ready **must check the base before
  merging**; gating on PR state alone would merge it into another feature branch. Both are
  waiting on **#38**, which holds `server.ts`; that sequencing is the thread's and is correct.
  **Item 67 changes no displayed blood-pressure value — host ground truth, and the thread's PR
  body overstated it.** `users.metric_priorities` for user 1 has
  `blood_pressure: [withings, apple_health, cronometer, hevy, manual]`, so `healthsync` is
  genuinely unlisted — but it only matters where healthsync competes with a listed source, and
  there is **exactly one such day in the table: 2026-09-17**. The thread's "24 Aug to 17 Sep
  2026" window is wrong: healthsync is the *sole* BP source on all 16 of its days in that
  window and on the 16 days after it, and an absent priority entry cannot displace anything
  when there is no alternative. On 2026-09-17 all three sources carry an identical **99/65**
  (apple_health twice, 01:00 and 21:32; withings 21:32:34; healthsync 21:39:19), so the winning
  source label changes from healthsync to withings and the number on screen does not move.
  Row counts for `blood_pressure_%`: healthsync 132 (2026-08-24..2026-10-19), withings 20 and
  apple_health 14 (both 2025-12-08..2026-09-17). Told in-thread, verified landed. **No Kieron
  decision needed** — there is no visible delta to warn him about.
  DB access note for the next session: it is `docker exec postgres psql -U vitality -d health`,
  there is no `settings` table (metric priorities live in `users.metric_priorities`), and
  `metrics` has no `date` column — use `timestamp::date`.

- **2026-10-21 18:08 (builder) — CORRECTION to the 18:04 entry above (`b95ce558`).** **"Item 67
  changes no displayed blood-pressure value" is wrong. Two displayed readings change.** The
  cloud session caught it on #41 and it was right; the host check below is builder's own and
  confirms its figures exactly:
  - **2025-12-08: 117/73 → 125/74.** apple_health has one reading (117/73, stamped 00:00:00);
    withings has two (133/75 at 13:51:09 and 117/73 at 19:51:56), mean **125/74**.
  - **2026-05-10: 103/69 → 103/68.** apple_health 102.5/69, withings 103/68 — today's display
    is itself split-source (withings systolic, apple_health diastolic), so only the diastolic
    moves.
  **Where the 18:04 entry went wrong:** it tested only *healthsync* contention and then
  generalised from it. Item 67 makes the `blood_pressure` priority key live, and that key
  orders **withings above apple_health** — a second mechanism, independent of healthsync, on
  days where both of those sources have readings. The healthsync half of the 18:04 entry still
  stands: one contested day (2026-09-17), all sources identical 99/65, label-only change. On
  the other six overlap days (2025-12-09, 12-15, 2026-03-09, 03-23, 03-31, 04-09) apple_health
  carries only the diastolic and its value equals withings', so nothing visible changes there.
  **So: item 67 changes the source label on 2026-09-17 and the displayed numbers on exactly two
  days, 2025-12-08 and 2026-05-10.** That is the sentence to carry forward. The `125/74` is a
  mean of two real readings that was never itself measured — that is **row 69**, logged by a
  sibling builder session, and it needs Kieron's call (daily average, latest reading, or every
  reading). Item 67 does not depend on that answer.

- **2026-10-21 18:44 (builder).** **Row 69 is answered: latest reading, blood pressure only.**
  Kieron typed "On bp - latest reading" into the claude.ai thread at **18:06** from his own
  session and the thread started work on it. Recorded on row 69 (`aff15c0d`) with the scope
  noted — he said "on bp", so weight and body fat keep today's daily average until he says
  otherwise. **How to read this if you are a later session:** builder treats the claude.ai page
  as Tier 3, so this is an *observed thread message*, not an instruction that arrived on a Tier 1
  channel. builder asked him to confirm on Telegram at 18:42; the confirmation lands on row 69
  when it arrives. It is a reversible display choice and the answer is unsurprising, so it is
  not a reason to stall — but do not cite a claude.ai thread as the authority for anything
  irreversible.
  Row 69 is still **unclaimed** and needs the usual draft PR from the cloud session.
  **PR state unchanged since 17:07 UTC and all three are drafts**, so `vitality-pr-watch-6c6d`
  has correctly done nothing: **#38** item 65 (`server.ts +6/-167`), **#40** item 66 (**no
  `server.ts` change** — the thread is honouring the one-branch-in-`server.ts` hold and will
  push that half after #38 merges), **#41** item 67 (base is still #40's branch). Row 69 is
  independent of items 66 and 67; nothing is blocked on it.

- **2026-10-23 06:35 (builder).** **Items 66 and 67 are closed, merged and verified against the
  live database.** `480dcc8` (item 66, PR #40) and `e375245` (item 67, PR #41) are both
  ancestors of HEAD `9137f08`, and the running `vitality` container's bundle contains
  `PAIRED_TYPES`, so the fix is deployed, not just committed. The tracker entries above were
  last updated 2026-10-21 18:44, when all three PRs were still drafts — they are stale, not
  open.
  **Live verification, not a re-read of the PRs:** ran `chooseSource` from
  `src/lib/sourcePriority.ts` over the per-(day, source, type) row counts for **every**
  `blood_pressure%` day in the `health` database, with the `blood_pressure` priority list the
  settings UI writes. **Zero mixed days** — systolic and diastolic resolve to the same source
  on every day that has blood pressure. The six days the bug was found on (2025-12-09, 12-15,
  2026-03-09, 03-23, 03-31, 04-09) all now resolve whole to `withings`: `apple_health` holds
  only the diastolic on those days, so the paired resolver prefers the source that has both
  halves. `src/lib/sourcePriority.test.ts` (21 tests) and `src/lib/aggregatedMetrics.test.ts`
  (65 tests) pass.
  **Numbering note for later sessions:** a builder status report on Kieron's Telegram line
  called these "#65 and #66". That was wrong — it was off by one against this tracker. The
  mixed-source pair is **item 66** and the dead `blood_pressure` priority key is **item 67**.
  Tracker item 65 is roadmap feature 1 (PR #38). Cite tracker numbers from this file.
  **Still genuinely open:** item 64 — `logEvent` escapes control characters for the file sink
  but writes the raw message into the `logs` table.

## 2026-10-23 06:45 — duplicate workouts from a second source (builder)

Kieron: *"There's a traditional strength training workout showing which corresponds
with this mornings Hevy workout. This shouldn't appear where a workout from another
source with more detail exists."*

One training session reaches `workouts` from more than one ingest path. Hevy writes it
with its routine name, 8 exercises and their sets; HealthSync writes the same half hour
as a bare `Traditional Strength Training` with a duration only. Both are legitimate
writes — the `(user_id, type, timestamp, source)` uniqueness that makes `metrics`
collision-proof has no equivalent on `workouts` — so the session was listed twice.

Both pre-existing de-dupe mechanisms are hardcoded to `source = 'apple_health'`
(`modules/apple_workouts.ts:113` at ingest; `POST /api/debug/deduplicate`), and
HealthSync rows are written straight into Postgres by `kb-health` on the host, outside
this app, so neither could ever see them.

Fixed on the **read path**, source-agnostic: `src/lib/workoutDedupe.ts` hides a workout
when a *different* source describes the same session (±30 min) with more detail, ranking
on recorded exercise count first and falling back to source rank only when detail ties.
Wired into `/api/data/summary`, which is what feeds the workouts list, with the
suppressed rows' exercises and sets filtered out alongside them.

Deliberate choices:

- **Read path, not ingest.** An ingest guard only ever protects whichever row arrives
  second, and here the *hevy* row was inserted last (id 203071 > 203066) — it would not
  have caught this. Nothing is deleted either, so exports and backfills still see the
  row.
- **Cross-source only.** Two rows from the same source half an hour apart are two
  workouts; the live DB has 8 such `apple_health` pairs and they are untouched.
- **Not applied to `/api/ai/data`** — that route already filters `source = 'hevy'`.
- **Not applied to `workouts.csv`** — an export should stay raw.

Verified against all 488 live workout rows: exactly 2 suppressed, both the known
healthsync/hevy pairs (2026-10-19 and today), 486 kept. 835 tests pass, 16 of them new.

Noticed, not actioned: `apple_health` workouts stop at **2026-10-13** (Health Auto
Export appears to have stopped sending them), and 8 intra-`apple_health` duplicate pairs
remain.

## 2026-10-23 10:02 — Data Freshness windows widened (Kieron, Telegram)

> "The Data freshness window for apple workouts can be extended to 48 hours. Data
> freshness window for Withings can be extended to 7 days"

`src/lib/freshness.ts`: `apple_workouts` 24h -> 48h, `withings` 24h -> 168h.

Deliberate: **`apple_health` stays at 24h.** It and `apple_workouts` are the two
halves of the same Health Auto Export source but they fail differently — HAE is run
by hand and its workout payload is sparse by design (latest `apple_health` workout
row is 2026-10-13, which Kieron confirmed is normal), while the metrics half pushes
thousands of points on every run, so a quiet day there is a real fault worth a red
badge. Grading them together would have meant either hiding a real metrics outage or
crying wolf on every workout gap.

`STALENESS_THRESHOLD_HOURS` is the single source of truth — `SyncHealthWidget` reads
both the status and its "stale after Nh" tooltip through `stalenessThresholdHours()`,
so no second copy needed updating. Two tests that happened to use `withings` as their
24h example were repointed at `apple_health`, and the withings boundary now has its
own 5-day-good / 8-day-stale case. 837/837 pass, typecheck clean.
