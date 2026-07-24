# codex-pair v0.3.0 design

Agreed between Claude and Codex (pair label 0.3.0,
thread 019f8d70-5f47-7002-a0d3-35a2a8048c4c) after five
design rounds, 2026-07-23. Revision 1.

## 1. Design artifact, wrapper-owned lifecycle

The artifact lives in the repo at
`.codex-pair/design-<label>.md`, never auto-committed
(committing is the user's Git action). Wrapper state
stores `{path, sha256, revision, status}` with status
one of `draft | agreed | amending`.

Commands (the skill never edits state directly):

- `design-register --label --path <repo-relative>`:
  creates or updates the draft record. Resets
  `designRounds` only when no design record exists for
  the label (initial draft); updating an existing
  draft's path or hash preserves the counter. Errors
  against `status: agreed`, naming `design-amend` as the
  path. The path must resolve inside the pair's cwd
  after symlink resolution.
- `design-agree --label`: recomputes the file hash,
  moves draft/amending to `agreed`, increments
  `revision` (first agreement is revision 1).
- `design-amend --label`: sets `status: amending` and
  atomically clears design capState, review capState,
  the active review cycle, and `reviewRounds`; resets
  `designRounds` to 0.

Review-kind sends require `status: agreed` AND stored
hash == current file hash AND the path still existing
inside the repo. Any failure names the specific
violation and points at `design-amend`.

## 2. Typed sends, rounds, review cycles

`send` requires `--kind design|review|freeform`.
Freeform is uncounted. Counters increment only on
successful codex turns.

- `designRounds`: increments per successful design send;
  reset by `design-amend` and by initial
  `design-register`.
- `review-start --label`: requires `status: agreed` and
  NO active cycle; issues a stable monotonic `cycleId`,
  sets `reviewRounds: 0`. Review sends require
  `--cycle-id` (must equal the active cycle) and
  `--snapshot-id` (informative, recorded per round);
  `reviewRounds` increments within the cycle regardless
  of snapshot changes.
- `review-complete --label --cycle-id
  --outcome approved|user-decided` (decision text on
  stdin when user-decided): records
  `{cycleId, outcome, decision?, at}`, clears the active
  cycle, `reviewRounds`, and review capState. Cycles end
  only via `review-complete` or `design-amend`.

## 3. Caps

Design cap 5, review cap 4 per cycle. Reaching a cap
sets `capState: decisionRequired` for that kind and the
wrapper's JSON output includes a disagreement-packet
skeleton for the skill to fill (both positions, evidence,
user decision needed). Counted sends of that kind then
fail until `override-cap --label --kind <kind>` runs with
the user's decision text on stdin; it appends
`{at, kind, decision}` to `capOverrides` and grants one
permit, consumed by the next successful counted send of
that kind. `design-amend`, `design-agree`, and `end`
clear capState for their kind. Overrides are visible in
`list` output.

## 4. Snapshot

`snapshot --label` emits one JSON envelope:
`{snapshotId, patch, omitted, warning}`.

- Patch assembly, per path in bytewise path order:
  tracked changes via
  `git -c core.quotePath=false -c diff.renames=false
  diff --no-ext-diff --no-color --no-textconv HEAD --
  <path>`, then untracked files
  (`git ls-files --others --exclude-standard`, same
  order) as unified diffs against `/dev/null` with the
  same flag set. `LANG`/`LC_ALL` set to `C` for child
  git processes. Ignored files excluded. The index is
  never modified; no `git add -N`.
- Binary files and diff bodies that are not valid UTF-8
  contribute a one-line
  `Binary file <path> differs (N bytes)` marker instead
  of body bytes. Empty untracked files appear with a
  zero-hunk header. Paths appear in canonical Git
  C-style quoting for bytes outside printable ASCII.
- The 300 KB cap applies to the `patch` field: per-path
  pieces are appended in order until the next piece
  would overflow; every remaining path goes to
  `omitted` as `{path, bytes, reason}`. `omitted` holds
  at most 100 entries and 8 KB serialized, whichever
  comes first; when truncated it ends with
  `{aggregate: {omittedFiles, omittedBytes}}` covering
  everything not listed. `warning` is null or a one-line
  omission summary.
- `snapshotId` = SHA-256 over the exact UTF-8 bytes of
  the `patch` field plus the canonical `omitted`
  serialization: JSON with keys in fixed order
  (path, bytes, reason), entries sorted bytewise by
  path, no insignificant whitespace. Identical worktrees
  yield byte-identical output.

## 5. State schema v2

`loadState` accepts absent `schemaVersion` or
`schemaVersion: 1` as v1 and migrates in memory to v2
(rounds, capState, design fields, defaults), persisting
on the next save. It rejects with named errors:
non-integer versions, integers below 1, versions above
2. A migrations framework and `doctor` remain deferred.

## 6. Deferred to v0.4

`attach`, `cancel`, richer status fields, migrations
framework, `doctor`, operation IDs, progress log
retention.
