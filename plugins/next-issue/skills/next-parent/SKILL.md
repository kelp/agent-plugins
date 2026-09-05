---
name: next-parent
description: >
  Land one GitHub parent issue's remaining open sub-issues
  by running next-issue once per child. Default is the
  parent of the next ready sub-issue. Use when the user
  runs /next-parent or asks to land a parent issue. Do
  not use this for a single sub-issue; that is /next-issue.
user-invocable: true
argument-hint: "[parent issue number or title substring]"
---

# /next-parent

Orchestrator only. It does not replace `/next-issue`.
That skill still lands **one** sub-issue. This skill
picks one parent GitHub issue, then runs `/next-issue`
once per remaining open sub-issue.

The live queue is GitHub Issues. A `parent` issue is a
category. Each sub-issue is one PR. `TODO.md` is an
archive, not the picker.

The project's CLAUDE.md is the architecture contract.
If this skill conflicts with that file or the **Rules**
binding, follow those files.

## Input

Parent: $ARGUMENTS

- Empty → the parent of the next ready or in-progress
  sub-issue (§1).
- A parent issue number, or a unique title substring →
  that parent.

## Binding

Same seven values as `/next-issue`. Read `## Next issue
binding` in the project's CLAUDE.md. If that heading is
missing, read `## Next TODO binding`. If both are
missing, stop and tell the user to run
`/next-issue-init`.

This skill uses **Backlog**, **Plan**, **CI**, and
**Rules**. Plan, TDD, and patch review stay in
`/next-issue`.

## Overlay (every next-issue run)

Pass these into each `/next-issue` invocation. They
override that skill's "one slice then stop" and "branch
from `origin/main`" steps for this session only:

1. GitHub PR base is `main`. Never a feature branch.
2. The first sub-issue branches from `origin/main`. Each
   later sub-issue branches from the previous slice
   HEAD. Later branches may contain earlier slice
   commits. That is a commit stack, not a stacked-PR
   base.
3. Do not open a second PR for a sub-issue that already
   has an open PR against `main`.
4. In the PR body, name predecessor PRs in this stack
   and the slice-only range (`<prev-tip>..HEAD`).
5. Do not merge. Do not enqueue on the merge queue
   unless the user asks.

## 1. Choose the parent

1. Fetch `origin/main` when the local default branch may
   be stale.
2. Pick the parent issue:
   - **Default** — no name given. In **Backlog**, find
     the next sub-issue with `ready` or `in-progress`
     (not `blocked`, not a `parent` issue), using each
     parent's Children list, else GitHub sub-issue
     order. A local Plan at **Plan** may refine that
     order for this session. Use that child's parent.
   - **Named** — match a unique substring or issue
     number. If zero names match or several match, stop
     and report. Do not guess.
3. Open that parent. Stop if it carries `blocked`.
4. List remaining open sub-issues of that parent, in
   Children order, that carry `ready` or `in-progress`.
   Stop if the list is empty and no open PRs remain for
   this parent.
5. List open PRs against `main` that claim those
   sub-issues.

Then pick a mode:

- **Drain** — every remaining sub-issue already has an
  open PR against `main`, or the user asked only to fix
  review comments. Go to §3.
- **Resume** — some have open PRs and later ones do
  not. Continue from the last open slice's HEAD. Go to
  §2 for the missing sub-issues.
- **Create** — none have an open PR against `main`.
  Confirm local `main` matches `origin/main`. Go to §2.

## Blockers

Before each remaining sub-issue H, stop and report if
any of these hold. Do not skip H. Do not start later
sub-issues.

- H or the parent carries `blocked`.
- A Depends-on clause names a predecessor that is not
  closed, or whose change is not on `origin/main`. An
  open PR is not a landing.

## 2. Run next-issue once per sub-issue

For each remaining sub-issue, in order:

1. Evaluate blockers. If one holds, stop and report.
2. Load `next-issue`. Pass the sub-issue number, that
   this is one slice in a `/next-parent` session, and
   the overlay above. Do not tell it to pick from
   `TODO.md`.
3. Let it plan, review, implement, and open a **draft**
   PR against `main`.
4. Do not wait for human review before the next
   sub-issue. If you push a fix to slice k, rebase later
   section branches onto that HEAD before you continue.
5. Record the PR URL and the slice tip SHA, then run
   `next-issue` for the next sub-issue.

After the last sub-issue has a PR, report every PR URL
and the child issue. Stop. Do not merge. Do not start
the next parent.

When a review event arrives, or when the user runs
`/next-parent` again, go to §3.

## 3. Drain through next-issue

Pick the parent the same way as §1. For each open PR in
that parent, in listed order, load `next-issue` and run
its comment drain (§5 of that skill) on that PR.

After a drain push to slice k, rebase later branches
onto that HEAD (`--force-with-lease`).

Stop when the `next-issue` all-clear holds on every
open PR in this parent. Report the URLs. Do not merge
unless the user asks.

## What not to do

- Do not name this skill `next-issue`. That name is the
  one-sub-issue skill.
- Do not pick work from `TODO.md`.
- Do not reimplement plan, TDD, or patch review.
  `next-issue` does that work.
- Do not set PR base to a feature branch.
- Do not combine two sub-issues into one PR.
- Do not start a second parent in this session unless
  the user names it.
- Do not merge or enqueue unless the user asks.
