---
name: next-section
description: >-
  Land one GitHub parent category's child issues by running
  next-todo once per PR-sized child, as a main-targeted
  commit stack. Default is the parent that contains the next
  Plan-ordered child. The user may name a different parent.
  Use when the user runs /next-section or asks to land a
  parent category. Do not use this for a single slice; that
  is /next-todo.
user-invocable: true
argument-hint: "[parent title substring or issue number]"
---

# /next-section

This skill is an orchestrator. It does not replace
`next-todo`. That skill still lands **one** slice. This
skill picks one parent category, then runs `next-todo` once
per remaining child in it.

The project's CLAUDE.md is the architecture contract. This
skill is the operating procedure. If this skill conflicts
with that file or the **Rules** binding, follow those files.

## Input

Parent: $ARGUMENTS

- Empty → the parent that contains the next Plan-ordered
  child (§1).
- A parent issue number or a unique title substring → that
  parent.

## Binding

Read `## Next TODO binding` in the project's CLAUDE.md. If
that heading is missing, stop and tell the user to run
`/next-todo-init` first. This skill uses the same seven
values as `next-todo`:

1. **Backlog** — the GitHub repository that holds the
   issues.
2. **Plan** — where a local Plan lives. It may refine child
   order for one session.
3. **Spec** — spec file(s) and the approval rule.
4. **Gates** — local commands before each commit.
5. **CI** — required checks before enqueue.
6. **Review axes** — replacements for the `next-todo`
   defaults, if any.
7. **Rules** — TDD, style, and dependency files.

## How to find the next slice

The live work queue is GitHub Issues in the repository that
**Backlog** *(binding)* names. The labels are the state.
`parent` marks a category issue. A child issue carries
`ready`, `in-progress`, or `blocked`.

1. The **Children** list in the parent issue body orders
   the children. Every agent and host can read it. A local
   Plan in **Plan** *(binding)* may refine that order for
   one session; no other tree sees that Plan. In this file,
   *Plan order* means this order.
2. Take the first child in that order with `ready` or
   `in-progress`.
3. Skip a `blocked` child. Skip a `parent` issue that has
   no `ready` child.
4. One child issue is one PR-sized slice.
5. Do not pick the first unchecked `TODO.md` heading.
   `TODO.md` is an archive. Do not copy `TODO.md` into
   Issues.

If the parent body has no Children list, use the sub-issue
order on GitHub.

## When to use

Use this skill when the user runs `/next-section` or asks
to land a parent category.

Do not use this skill for a single slice. Load `next-todo`
instead (`/next-todo`), and pass that child issue.

Do one parent category, then stop. Do not continue into
the next parent unless the user asks.

A named parent may run in another git worktree on the
same host, or on a separate host. This checkout does not
see that work. Do not search other worktrees or hosts. The
user names the parent. That is the only coordination.

## Overlay (every next-todo invocation)

Pass these constraints into each `next-todo` run. They
override that skill's "one slice then stop" and "branch
from `origin/main`" steps for this session only:

1. GitHub `base` / `base_branch` is `main`. Never a feature
   branch.
2. Slice 1 branches from `origin/main`. Slice N+1 branches
   from slice N's HEAD. The later branch may contain the
   earlier slice commits. That is a commit stack.
3. Do not merge a slice into another feature branch.
4. Do not open a second pull request for a child issue that
   already has an open pull request against `main`.
5. In the pull request body, name predecessor PRs in this
   stack and the slice-only range (`<prev-tip>..HEAD`).
6. Do not merge. Do not enable auto-merge. Do not enqueue
   on the merge queue unless the user asks. When they do,
   follow §4 (ready, wait for required checks, then
   enqueue in listed order). Do not run `gh pr merge`
   while required checks are pending: that enables
   auto-merge instead of joining the queue. After the
   parent names the order and confirms checks, send
   enqueue, fetch, a clean rebase, and `--force-with-lease`
   push to a worker pinned to a cheap model when the
   client can pin one.
7. After a predecessor lands (especially a squash), rebase
   remaining section branches onto `origin/main` and drop
   the landed commits. Push later branches with
   `--force-with-lease`. Do not force-push `main`. A worker
   may do a clean rebase. Return to the parent when the
   rebase stops on `TODO.md`, `CHANGELOG.md`, or any file
   the **Rules** binding reserves for the parent.

## 1. Choose the parent and the mode

1. Fetch `origin/main` when the local default branch may be
   stale.
2. Pick the parent category:
   - **Default** — no name given. Open GitHub Issues in
     **Backlog**. Find the next Plan-ordered child with
     `ready` or `in-progress` (not `blocked`, not a
     `parent` issue). Use that child's parent issue as the
     category. Do not use `TODO.md` checkbox state.
   - **Named** — the user named a parent (`/next-section`
     arguments, an issue number, or an explicit parent
     title). Match a unique substring or number. If zero
     names match or several match, stop and report the
     matches. Do not guess. Do not look for other
     worktrees or hosts.
3. Open that parent only. Read its children and blockers.
   Do not treat a blocked parent as a source of ready
   children. Evaluate blockers before each remaining
   child (see **Blockers** below).
4. List remaining child issues of that parent in Plan
   order that are open and carry `ready` or `in-progress`.
   Stop if the list is empty and no open pull requests
   remain for this parent.
5. List open pull requests against `main` that match those
   children (and still-open PRs from this parent even when
   GitHub has not closed the child). A pull request whose
   base is not `main` is not landed work. An open pull
   request against `main` whose title or body names this
   parent claims the category. That claim refuses
   **Create** only. Drain and Resume still run.

When a child was claimed from a `TODO.md` heading, check
that heading off only. On rebase of `TODO.md` or
`CHANGELOG.md`, keep theirs, then re-apply yours. Never
rewrite a sibling CHANGELOG bullet.

Then pick a mode:

- **Drain** — every remaining child already has an open
  pull request against `main`, or the user asked only to
  fix review comments. Go to §3.
- **Resume** — some children have open PRs against `main`
  and later children do not. Continue from the last open
  slice's HEAD. Go to §2 for the missing slices.
- **Create** — no child has an open pull request against
  `main`. Confirm local `main` matches `origin/main`.
  Refuse Create if this parent is already claimed, or if
  the first remaining child's blockers are unsatisfied.
  Go to §2 from that commit.

## Blockers (per remaining child)

A parent issue body may carry a **Blockers** list. Each
clause uses one of the forms below. Evaluate blockers
before each remaining child H. An open pull request is not
a landing. A Merged badge is not a landing.

1. A named predecessor child applies to every remaining
   child until that predecessor is closed and on
   `origin/main`. Skip this clause when H *is* that named
   child.
2. A clause qualified with `before` or `for` named
   children applies only to those listed children.
3. `user approval of` a document, spec note, or design
   note does **not** apply to H when H is the child that
   writes that document **and** every remaining checkbox
   or task under H is document-writing. If H still has
   implementation work, approval applies. Do not keep
   implementation tasks under a design-note child.
4. `none` or `none for the design note` means the
   design-note or spec slice in this parent has no extra
   gate.
5. `no open pull request against main for` a named child
   is unsatisfied while an open pull request against
   `main` claims that child. A `before` qualifier still
   applies.
6. A `blocked` label, a `blocked` parent, or an unsatisfied
   Depends-on clause on the issue is unsatisfied.
7. If any applicable clause is unsatisfied, stop and
   report. Do not skip H. Do not start later slices.

## 2. Run next-todo once per child

For each remaining child, in Plan order:

1. Evaluate blockers for this child. If a clause that
   applies to it is unsatisfied, stop and report.
2. Load `next-todo`.
3. Tell it the child issue, that this is one slice in a
   `/next-section` session, and the overlay above. Do not
   tell it to pick from `TODO.md`.
4. Let it plan, review, implement, patch-review, and open
   a **draft** pull request against `main`. That is the
   whole `next-todo` slice procedure except "do not start
   a second slice" and except waiting for human review
   before it returns.
5. Do not wait for human review before the next child.
   Fix bot comments that are already present. If you push
   a fix to slice k, rebase later section branches onto
   that HEAD before you continue.
6. Record the PR URL and the slice tip SHA, then run
   `next-todo` for the next child.

After the last child has a pull request:

1. Subscribe to each section PR for review comments when
   the client has that tool.
2. Report every PR URL, the child issue, and the
   merge-queue order.
3. Stop. Do not merge. Do not start the next parent.

When a review event arrives, or when the user runs
`/next-section` again, go to §3.

## 3. Drain through next-todo

Pick the parent the same way as §1 (default from
Plan-ordered GitHub children, or the name the user gave).
For each open pull request in that parent, in listed
order, load `next-todo` and run its review-comment drain
(§5 of that skill) on that PR.

Tell `next-todo`: when a thread is a valid false positive,
record why the **Rules** reject it, then **resolve** that
thread. An adjudicated rejection counts as cleared. The
stop condition is no remaining unresolved threads.

After a drain push to slice k, rebase later section
branches onto that HEAD (`--force-with-lease`).

Stop when the `next-todo` all-clear holds on every open
section PR (including resolved rejections). Report the
URLs. Do not merge unless the user asks. When they ask to
land, go to §4.

## 4. Enqueue on the merge queue

Only when the user asks to land:

1. Mark each still-draft section pull request ready for
   review. Drafts cannot enter the merge queue.
2. Wait for the required checks in **CI** *(binding)* and
   required bot reviews on each PR. Subscribe when that
   tool exists. Do not wait without a deadline.
3. Do not run `gh pr merge` (or enable auto-merge) while
   those checks are pending. That enrolls auto-merge
   instead of the queue.
4. After checks are green, enqueue in listed order on
   `main` only. Do not merge into a feature branch. Do not
   enqueue a Dependabot pull request.

The parent names that order and confirms the required
checks. Send enqueue (no `--auto`), `git fetch origin
main`, a clean `git rebase --onto` that drops landed
commits, and `--force-with-lease` push to a worker pinned
to a cheap model when the client can pin one. Return to
the parent when a rebase stops on `TODO.md` or
`CHANGELOG.md`, or when checks are not green.

## What not to do

- Do not name this skill `next-todo`. That name is the
  one-slice skill.
- Do not treat an unchecked `TODO.md` heading as the live
  picker when choosing the default parent or listing
  remaining children.
- Do not copy `TODO.md` into Issues.
- Do not reimplement plan, TDD, or patch review here.
  `next-todo` does that work.
- Do not set `base_branch` to a feature branch.
- Do not combine two child issues into one pull request.
- Do not start a second parent category in this session
  unless the user names it.
- Do not search other worktrees or hosts for sibling
  agents. The user names the parent.
- Do not start Create when the first remaining child's
  blockers are unsatisfied or when an open pull request
  against `main` already claims this parent.
- Do not treat a claimed parent as a stop for Drain or
  Resume. Named `/next-section` must still drain or
  resume existing pull requests.
- Do not treat user approval of a note as blocking the
  child that writes that note when that issue is
  document-only. Do not keep implementation tasks under
  a design-note child.
- Do not enqueue or merge unless the user asks. When they
  ask, follow §4: mark ready, wait for required checks,
  then enqueue. Do not enable auto-merge.
