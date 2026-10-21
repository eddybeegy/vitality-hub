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
