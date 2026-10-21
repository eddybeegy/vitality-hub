# Remediation coordination

Two threads work this list:

- **cloud** — a claude.ai project session working from this repo. Self-contained
  front-end items and the `timestamptz` migration draft. No access to the deploy
  host, the database, or a live browser.
- **builder** — the host/ops agent on `ser5`. Everything that needs SQL ground
  truth, a deploy, or verification against the running app. Also merges, deploys
  and verifies every cloud PR.

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
3. **Only builder edits `progress.md`**, so PRs never conflict in the tracker.
   Put your status in the PR body instead; builder records the result and the
   merge sha when it lands.
4. **PR body states** what changed, what a reviewer should see on screen or in the
   response body, and what you could not check.
5. builder runs five gates before merging: the diff stays in scope for the named
   item; `npx tsc --noEmit` adds no error beyond the two known pre-existing ones;
   `npx vitest run` is green (baseline 2026-10-21: 5 files, 60 tests, 1.3 s — pass
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
