---
name: next-issue
description: >
  Land one GitHub child issue as one pull request: choose the next child
  issue, write a plan, review the plan (three axes, or Astra only for a
  non-behavior exception), implement with red-green TDD, open a draft pull
  request, and drain review comments until CI is green and no threads
  remain. Use when starting a slice, landing the next child issue, planning
  a slice, or when asked to address all PR review comments until they are
  fixed. Previously /next-todo.
user-invocable: true
---

# /next-issue

Do this whole procedure for one slice. Do not skip the plan review. Do not
skip the comment drain. Do not start a second slice in the same change.

The project's CLAUDE.md is the architecture contract. This skill is the
operating procedure. If this skill conflicts with that file or the
**Rules** binding, follow those files.

## Input

Slice: $ARGUMENTS

- Empty → pick the next child issue from the backlog (§1).
- An issue number → that child issue is the slice. Do not ask the user
  which issue to take. An orchestrator such as `/next-parent` passes this
  number once per child.

## Binding

Read `## Next issue binding` in the project's CLAUDE.md. If
that heading is missing, read `## Next TODO binding` (the
old name). If both are missing, stop and tell the user to
run `/next-issue-init` first.

Every value marked *(binding)* below comes from that section:

1. **Backlog** — the GitHub repository that holds the issues.
2. **Plan** — where the plan artifact lives. A local Plan there may refine
   child order for one session.
3. **Spec** — spec file(s) and the approval rule.
4. **Gates** — local commands before each commit.
5. **CI** — required checks the parent waits on.
6. **Review axes** — replacements for the defaults below, if any.
7. **Rules** — TDD, style, and dependency files.
8. **Claims** — optional. A command that takes one issue number, takes
   a lock on that issue, and prints the directory to work in. Unset
   means no lock: branch from `main` in the current checkout.

## When to use

Use this skill when the user asks to land a slice, do the next child
issue, plan a slice, or drain PR review comments to all-clear.

Do not use this skill for work that is not a child issue, unless the user
maps that work onto a named child issue. Do the user's requested work
instead.

## 1. Choose the work

The live work queue is GitHub Issues in the repository that **Backlog**
*(binding)* names. The labels are the state:

- `parent` marks a category issue. A parent issue is not work.
- A child issue is a sub-issue of a parent. One child issue is one pull
  request.
- A child issue carries `ready`, `in-progress`, or `blocked`.

`TODO.md` is an archive. Never pick work from `TODO.md`. Never treat an
unchecked `TODO.md` heading as work.

### Named child

If the argument is an issue number, open that issue. Stop and report if it
carries `parent`. That child issue is the slice.

If an open pull request against `main` already claims that child, do not
open a second pull request. Go to §5 and drain that pull request.

### Default child

If the argument is empty:

1. List the open issues that carry `parent`, in ascending issue number.
2. In each parent, read the children in order. The **Children** list in
   the parent issue body gives the order. If the body has no Children
   list, use the GitHub sub-issue order. A local Plan at **Plan**
   *(binding)* may refine that order for one session.
3. Take the first child that carries `ready` or `in-progress`. Skip a
   child that carries `blocked`. Skip an issue that carries `parent`. Skip
   a parent that has no `ready` or `in-progress` child.
4. Stop and report when no child qualifies.

### Blockers

Before you start the child, evaluate its blockers. If one holds, stop and
report. Do not skip to another child.

- The child carries `blocked`.
- The parent carries `blocked`.
- A Depends-on clause in the child body names a predecessor child that is
  not closed, or whose change is not on `origin/main`. An open pull
  request is not a landing. A Merged badge is not a landing.

### Claim and branch

When **Claims** *(binding)* names a command, run it with the child issue
number before the plan. It takes the lock, records the claim on the
issue, sets `in-progress`, and prints the directory to work in. Work
there and nowhere else. Do not edit the checkout you ran it from. Exit
3 means another agent holds the child: for a default child, take the
next qualifying child; for a named child, stop and report the holder.
Do not plan, edit, or run **Gates** on an issue you do not hold.

When **Claims** is unset:

1. Fetch `origin/main` when the local default branch may be stale.
2. Confirm the local `main` matches `origin/main` before you branch.

Either way, record the child issue number and title. That is the slice
name.

Do not combine child issues. Do not pull in the next child "while you are
here."

## 2. Plan the slice

Write a plan before you change code. Keep the plan inside this slice.
Write a real plan artifact that reviewers can read, at the path in
**Plan** *(binding)*. A Cursor Plan is also fine when that client is in
use. Do not implement during planning.

The plan must include:

- Slice name (the child issue number and title)
- In scope (behavior, files, modules)
- Out of scope (the next child issues, named explicitly)
- Spec impact (no change, spec-first edit, or design-note only)
- Tests (which failing tests you will add)
- Risks (the ones the **Rules** binding cares about)

### Spec and design-note slices

A spec slice or a design-note slice still needs user approval before code
against that document, per **Spec** *(binding)*. Plan review is not that
approval. User approval of a document does not block the slice that
writes it when that child issue is document-only.

An implementation slice may proceed after plan consensus unless the user
asked you to wait.

## 3. Review the plan to consensus

Do not implement until this step ends in consensus.

### Review tier

- Behavior change or spec change: three axes (Grok, Astra, Opus 5), or the
  replacements in **Review axes**.
- Non-behavior exception (docs, comments, formatting, pins, or TODO or
  CHANGELOG updates with no code change): Astra only. Astra answers: does the
  plan violate the rules, and is this really a non-behavior exception? If
  Astra says the change is behavior or spec, stop. Promote to three axes
  before implementation.
- Skip this step only when the user explicitly says to skip plan review.

When Astra runs alone, the parent writes a short brief: child issue, in/out
of scope, and why the exception applies. Grok and Opus do not run.

### Default models

In Cursor, use the Task tool with these models and no substitute, unless
**Review axes** names replacements:

- Grok 4.6: `cursor-grok-4.6-high-fast`
- GPT-6-Astra: `gpt-6-astra-high`
- Opus 5: `claude-opus-5-thinking-high`

Stay at three reviewers. Do not add a fourth model. If a Cursor Task slug
is missing from the allowlist, report it and continue with the two that
remain. Do not invent a substitute.

The Astra axis has one fallback: GPT-5.6-Sol (`gpt-5.6-sol-high` in
Cursor, `-m gpt-5.6-sol` on the Codex CLI). Use it only when Astra
usage is exhausted or Astra returns a quota or availability error. Say
in the review record that Sol ran instead of Astra. No other axis has
a fallback.

On Claude Code or Codex, keep the same three axes and the same reply cap.
Use that client's native reviewer selection. Do not require Cursor Task
slugs. On the Codex CLI, Astra is the default model (`gpt-6-astra`), so
leave the model unset unless the fallback applies.

If a requested model is not available, do not pick a replacement. Report
the missing model. Continue only when at least two reviews return.

Tell every reviewer: find blocking issues; do not write code; reply with
blocking issues (or "none"), at most three non-blocking notes, and
APPROVE or REQUEST CHANGES. No file-by-file essay.

### Brief, then split axes

Do not send Astra or Opus the full **Rules** files or named source files as
separate attachments. A complete file that appears in the reviewed diff
is allowed.

1. Grok reads the plan and the files it names, then writes a one-page
   brief: child issue, in/out of scope, the test contract, and the 3–5
   files that would change. Grok also answers: one slice? process? the
   constraints in **Rules**? The parent writes that brief when Grok does
   not run. Astra and Opus still receive the brief.
2. Astra gets the brief, the plan, and only the **Rules** lines that apply
   to this slice. Include every applicable section: TDD versus the
   non-behavior exception, spec-first, and also dependency or workflow
   rules when the plan touches those. Astra answers: does the plan violate
   those rules, and does it agree with the attached spec excerpt?
3. Opus gets the brief and the plan Tests section. Opus answers: is the
   planned test contract enough? Do not require a test file or a RED run
   at plan review. Tests do not exist yet.
4. Spec impact: attach the full spec file only when the plan edits it.
   When the planned behavior falls in that spec and the plan says "no
   spec change," attach only the governing section so reviewers can
   check the claim. If the slice is outside the spec, write "no spec
   change" in the brief.

Reviewers must still see the **real plan**. Do not paraphrase the change
in place of that artifact.

### Later rounds

Resume the same agent. Send the delta plus that reviewer's prior
objection, or their prior approval when you re-run an axis that did not
object. Do not re-attach **Rules** files unless the delta changes which
rule applies.

Re-run **only the objector** unless the revision adds behavior, files, or
a spec change, or changes another axis's input (for example a rewritten
Tests section re-runs Opus). Nit-only dissent does not need a second
round. Do not start a fourth full-context round to break a tie: decide
from the repo rules and record the decision in the plan.

The parent watches CI. Reviewers do not `gh run view` or wait on checks.

Ignore Bugbot / Codex **usage-limit** comments. Those are not review.

Consensus means: no remaining blocking objection from a completed review.

## 4. Implement

Follow **Rules** *(binding)*. Open extra process docs only when that
binding says to.

For a behavior change:

1. Write a failing test.
2. Run that test and confirm the failure. Keep the command and output as
   session evidence for §4b.
3. Make the minimum change.
4. Run the same test and confirm the pass.
5. Run **Gates** *(binding)*. Do not commit a failing state.

You may skip red-green TDD only when the change does not change program
behavior. Still run **Gates** before each commit.

### TODO.md and CHANGELOG.md

`TODO.md` is an archive. If the child issue names a `TODO.md` heading that
it claims, check off that heading's boxes in the commit that lands the
change. Check off only that heading's boxes. If the child issue names no
heading, do not touch `TODO.md`. Do not copy `TODO.md` into Issues.

On a rebase that stops on `TODO.md` or `CHANGELOG.md`, keep theirs, then
re-apply yours. Never rewrite a sibling CHANGELOG bullet.

### Known defects

A pre-existing bug, or behavior outside this slice, that you find during
the slice is not work for this slice. Do not fix or extend it here unless
the slice cannot work without it. Open a new child issue under the
matching parent. When no parent fits, open a new standalone issue. Name
that issue in the pull request description. Do not append it to
`TODO.md`.

### Open the pull request

After the gates are green, commit. Push the branch. Open a draft pull
request against `main` unless the user asked for a ready PR. Do not set
the base to a feature branch.

When you open the pull request:

1. Put `Closes #<child>` in the pull request body, so the child issue
   closes on merge.
2. When **Claims** is unset, move the child issue from `ready` to
   `in-progress`: remove the `ready` label and add `in-progress`. A
   claim already did this.

Do not merge. Do not enable auto-merge. Do not enqueue on the merge queue.
Do not mark the PR ready unless the user asks.

## 4b. Review the patch

After the gates are green, review the **diff**, not the tree. Use the same
review tier as §3. Do not continue to the comment drain until this step
ends in consensus.

Prompt is the merge-base diff (`git diff origin/main...HEAD` or the
equivalent complete range) and the **complete plan**. Do not send a 10–20
line extract. Use bare `git show` only when the slice has exactly one
commit. Do not say "read `<path>`." Mention a test-only SHA versus an
impl-only SHA only when those commits exist.

For a three-axis patch review:

- Grok: does the diff match the plan and stay inside the **Rules**
  constraints?
- Astra: the applicable **Rules** excerpts on the diff, and does the diff
  agree with the attached spec excerpt?
- Opus: for a behavior change, the real test text and the captured
  failing command output from the RED run (session evidence). Are the
  tests enough, and is RED real? Does the guarding test still have teeth?
  For a non-behavior exception, verify the recorded exception. Do not
  require fabricated RED evidence.

For Astra-only patch review, Astra verifies the recorded exception and that
the diff matches the plan.

If a reviewer returns REQUEST CHANGES, fix the blocking issue or record
why the repo rules reject it. For every tracked fix, including a plan,
spec, or CHANGELOG edit, run **Gates**, commit, and push before you resume
review. Resume only the objector unless the revision adds behavior,
files, or a spec change, or changes another axis's input. Consensus
means: no remaining blocking objection from a completed review.

The parent watches CI. Prefer a subscription when the client has one.
When subscriptions are unavailable, the parent may use a wait with a
deadline. Reviewers do not poll runs. Ignore usage-limit bot comments.

## 5. Drain review comments to all-clear

Treat inline review threads as work. Loop until the stop condition.

On each loop:

1. List unresolved review threads and new review comments on the PR.
   Include bot reviews (Bugbot, Security Reviewer, and similar).
2. Ignore Codex and Bugbot **usage-limit** issue comments. Those are not
   code review. A Cursor Approval Agent "not approving because Bugbot
   skipped" note is also not a review finding.
3. For each remaining comment, either fix it or record a brief reason
   that the repo rules reject it.
4. For every tracked drain fix, run **Gates**, commit, and push. Use
   red-green TDD only for a behavior change. After a drain commit that
   changes behavior or the spec, adds or removes a file, or changes an
   axis's reviewed input, return to §4b and reach consensus again before
   you continue the drain. A wording-only edit in an existing file does
   not return to §4b.
5. Resolve only the threads that the new commit actually fixes. In Cursor
   Cloud, resolve through the pull-request tool, not a merge command.
6. Wait for every required check in **CI** *(binding)* to finish, plus
   any required bot reviews on the PR. Subscribe to CI and PR events when
   that tool exists. When it does not, the parent may use a wait with a
   deadline, for example `timeout 30m gh pr checks --required --watch`.
   Do not wait without a time limit. Do not wait on optional checks.
   Reviewers still do not poll.
7. Re-list unresolved threads and new comments after CI completes. Start
   this loop again when anything remains.

Do not post a "done" comment unless the user asks. Do not leave a valid
review thread open because the bot is slow. Wait, then look again.

### Stop condition

Stop when all of these are true:

- **Gates** passed with no warnings on the last commit
- Required CI checks are green
- There are no unresolved review threads
- No new review comment arrived after the last push

Then report the PR URL, the child issue, and that the comment drain is
all-clear. Do not merge or enqueue unless the user explicitly asks.

## What not to do

- Do not pick work from `TODO.md`. Do not treat an unchecked `TODO.md`
  heading as work.
- Do not start a child whose blockers hold. Do not skip to another child
  when one holds; stop and report.
- Do not open a second pull request for a child issue that already has an
  open pull request against `main`.
- Do not check off a `TODO.md` heading that the child issue does not
  claim.
- Do not append a known defect to `TODO.md`. Open an issue.
- Do not write code against a new spec or design note before the user
  approves that document.
- Do not substitute a different plan-review model when a named Cursor
  model is unavailable.
- Do not require Cursor Task slugs on Claude Code or Codex.
- Do not require a test file or a RED run at plan review.
- Do not send Astra or Opus the full tree, full **Rules** files, or "read
  this 9k-line file." Brief + real plan/diff + the rule excerpt that
  applies. Complete files inside that diff are allowed.
- Do not send Grok a truncated plan at patch review.
- Do not require fabricated RED evidence on a non-behavior slice.
- Do not add a fourth review model.
- Do not re-run all three models on a wording nit. Resume the objector
  with the delta. Re-run any axis whose input changed.
- Do not resume patch review on an uncommitted fix, even a docs-only fix.
- Do not plan, edit, or run **Gates** on a child the claim did not grant,
  and do not edit the checkout the claim command ran from.
  Run **Gates**, commit, and push first.
- Do not ask reviewers to watch CI. The parent may poll when
  subscriptions are unavailable.
