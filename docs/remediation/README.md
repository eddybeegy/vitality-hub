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
2. **One PR per item.** Do not touch `server.ts` unless the item names it —
   builder is editing the same file.
3. **Only builder edits `progress.md`**, so PRs never conflict in the tracker.
   Put your status in the PR body instead; builder records the result and the
   merge sha when it lands.
4. **PR body states** what changed, what a reviewer should see on screen or in the
   response body, and what you could not check.
5. builder runs four gates before merging: the diff stays in scope for the named
   item; `tsc` adds no error beyond the two known pre-existing ones; no DELETE of
   `apple_health` nutrition rows is reintroduced; no blanket `AT TIME ZONE` is
   applied to `metrics`/`workouts` (those columns hold a different zone per
   source — see `handoff.md`). A failed gate gets a comment on the PR, not a merge.
