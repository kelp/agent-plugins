---
name: next-todo
description: >
  Land one TODO.md PR slice: choose the next slice, write
  a plan, review the plan (three axes, or Sol only for a
  non-behavior exception), implement with red-green TDD,
  open a draft pull request, and drain review comments
  until CI is green and no threads remain. Use when
  starting a TODO slice, landing the next milestone PR,
  planning a slice, doing the next TODO item, or when
  asked to address all PR review comments until they are
  fixed.
user-invocable: true
---

# /next-todo

Do this whole procedure for one slice. Do not skip the
plan review. Do not skip the comment drain. Do not start
a second slice in the same change.

The project's CLAUDE.md is the architecture contract.
This skill is the operating procedure. If this skill
conflicts with that file or the **Rules** binding,
follow those files.

## Input

Slice: $ARGUMENTS

- Empty → pick the next slice from the backlog binding.
- A heading → that heading is the slice, if its
  predecessors are already on `main`.

## Binding

Read `## Next TODO binding` in the project's CLAUDE.md.
If that heading is missing, stop and tell the user to
run `/next-todo-init` first.

Every value marked *(binding)* below comes from that
section:

1. **Backlog** — file, how to pick the next slice, what
   one slice is.
2. **Plan** — where the plan artifact lives.
3. **Spec** — spec file(s) and the approval rule.
4. **Gates** — local commands before each commit.
5. **CI** — required checks the parent waits on.
6. **Review axes** — replacements for the defaults
   below, if any.
7. **Rules** — TDD, style, and dependency files.

## When to use

Use this skill when the user asks to land a slice, do
the next TODO item, plan a slice, or drain PR review
comments to all-clear.

Do not use this skill for work that is not a backlog
slice, unless the user maps that work onto a named
slice. Do the user's requested work instead.

## 1. Choose the work

1. Open the backlog *(binding)* the way that binding
   says. Do not read the rest of that file.
2. Fetch `origin/main` when the local default branch
   may be stale.
3. Confirm the local `main` matches `origin/main`
   before you branch.
4. If the user named a slice, take that heading. Stop
   if a predecessor is still open.
5. Otherwise take the next slice the binding names.
   Stop if a predecessor is still open.
6. Record the exact heading. That heading is the slice
   name. One heading is one pull request.

Do not combine slices. Do not pull in the next heading
"while you are here." After you land the slice, update
the backlog pointer the way the binding says.

## 2. Plan the slice

Write a plan before you change code. Keep the plan
inside this slice. Write a real plan artifact that
reviewers can read, at the path in **Plan** *(binding)*.
A Cursor Plan is also fine when that client is in use.
Do not implement during planning.

The plan must include:

- Slice name (the backlog heading)
- In scope (behavior, files, modules)
- Out of scope (the next headings, named explicitly)
- Spec impact (no change, spec-first edit, or
  design-note only)
- Tests (which failing tests you will add)
- Risks (the ones the **Rules** binding cares about)

### Spec and design-note slices

A spec slice or a design-note slice still needs user
approval before code against that document, per **Spec**
*(binding)*. Plan review is not that approval.

An implementation slice may proceed after plan
consensus unless the user asked you to wait.

## 3. Review the plan to consensus

Do not implement until this step ends in consensus.

### Review tier

- Behavior change or spec change: three axes (Grok,
  Sol, Opus 5), or the replacements in **Review axes**.
- Non-behavior exception (docs, comments, formatting,
  pins, or TODO or CHANGELOG updates with no code
  change): Sol only. Sol answers: does the plan violate
  the rules, and is this really a non-behavior
  exception? If Sol says the change is behavior or spec,
  stop. Promote to three axes before implementation.
- Skip this step only when the user explicitly says to
  skip plan review.

When Sol runs alone, the parent writes a short brief:
slice heading, in/out of scope, and why the exception
applies. Grok and Opus do not run.

### Default models

In Cursor, use the Task tool with these models and no
substitute, unless **Review axes** names replacements:

- Grok 4.6: `cursor-grok-4.6-high-fast`
- GPT-5.6-Sol: `gpt-5.6-sol-high`
- Opus 5: `claude-opus-5-thinking-high`

Stay at three reviewers. Do not add a fourth model. If
a Cursor Task slug is missing from the allowlist, report
it and continue with the two that remain. Do not invent
a substitute.

On Claude Code or Codex, keep the same three axes and
the same reply cap. Use that client's native reviewer
selection. Do not require Cursor Task slugs.

If a requested model is not available, do not pick a
replacement. Report the missing model. Continue only
when at least two reviews return.

Tell every reviewer: find blocking issues; do not write
code; reply with blocking issues (or "none"), at most
three non-blocking notes, and APPROVE or REQUEST
CHANGES. No file-by-file essay.

### Brief, then split axes

Do not send Sol or Opus the full **Rules** files or
named source files as separate attachments. A complete
file that appears in the reviewed diff is allowed.

1. Grok reads the plan and the files it names, then
   writes a one-page brief: slice heading, in/out of
   scope, the test contract, and the 3–5 files that
   would change. Grok also answers: one slice? process?
   the constraints in **Rules**? The parent writes that
   brief when Grok does not run. Sol and Opus still
   receive the brief.
2. Sol gets the brief, the plan, and only the **Rules**
   lines that apply to this slice. Include every
   applicable section: TDD versus the non-behavior
   exception, spec-first, and also dependency or
   workflow rules when the plan touches those. Sol
   answers: does the plan violate those rules, and does
   it agree with the attached spec excerpt?
3. Opus gets the brief and the plan Tests section.
   Opus answers: is the planned test contract enough?
   Do not require a test file or a RED run at plan
   review. Tests do not exist yet.
4. Spec impact: attach the full spec file only when
   the plan edits it. When the planned behavior falls
   in that spec and the plan says "no spec change,"
   attach only the governing section so reviewers can
   check the claim. If the slice is outside the spec,
   write "no spec change" in the brief.

Reviewers must still see the **real plan**. Do not
paraphrase the change in place of that artifact.

### Later rounds

Resume the same agent. Send the delta plus that
reviewer's prior objection, or their prior approval
when you re-run an axis that did not object. Do not
re-attach **Rules** files unless the delta changes
which rule applies.

Re-run **only the objector** unless the revision adds
behavior, files, or a spec change, or changes another
axis's input (for example a rewritten Tests section
re-runs Opus). Nit-only dissent does not need a second
round. Do not start a fourth full-context round to
break a tie: decide from the repo rules and record the
decision in the plan.

The parent watches CI. Reviewers do not `gh run view`
or wait on checks.

Ignore Bugbot / Codex **usage-limit** comments. Those
are not review.

Consensus means: no remaining blocking objection from
a completed review.

## 4. Implement

Follow **Rules** *(binding)*. Open extra process docs
only when that binding says to.

For a behavior change:

1. Write a failing test.
2. Run that test and confirm the failure. Keep the
   command and output as session evidence for §4b.
3. Make the minimum change.
4. Run the same test and confirm the pass.
5. Run **Gates** *(binding)*. Do not commit a failing
   state.

You may skip red-green TDD only when the change does
not change program behavior. Still run **Gates** before
each commit.

After the gates are green, commit. Push the branch.
Open a draft pull request unless the user asked for a
ready PR.

Do not merge. Do not enable auto-merge. Do not mark the
PR ready unless the user asks.

## 4b. Review the patch

After the gates are green, review the **diff**, not the
tree. Use the same review tier as §3. Do not continue
to the comment drain until this step ends in consensus.

Prompt is the merge-base diff (`git diff origin/main...HEAD`
or the equivalent complete range) and the **complete
plan**. Do not send a 10–20 line extract. Use bare
`git show` only when the slice has exactly one commit.
Do not say "read `<path>`." Mention a test-only SHA
versus an impl-only SHA only when those commits exist.

For a three-axis patch review:

- Grok: does the diff match the plan and stay inside
  the **Rules** constraints?
- Sol: the applicable **Rules** excerpts on the diff,
  and does the diff agree with the attached spec
  excerpt?
- Opus: for a behavior change, the real test text and
  the captured failing command output from the RED run
  (session evidence). Are the tests enough, and is RED
  real? Does the guarding test still have teeth? For a
  non-behavior exception, verify the recorded
  exception. Do not require fabricated RED evidence.

For Sol-only patch review, Sol verifies the recorded
exception and that the diff matches the plan.

If a reviewer returns REQUEST CHANGES, fix the blocking
issue or record why the repo rules reject it. For every
tracked fix, including a plan, spec, or CHANGELOG edit,
run **Gates**, commit, and push before you resume
review. Resume only the objector unless the revision
adds behavior, files, or a spec change, or changes
another axis's input. Consensus means: no remaining
blocking objection from a completed review.

The parent watches CI. Prefer a subscription when the
client has one. When subscriptions are unavailable, the
parent may use a wait with a deadline. Reviewers do not
poll runs. Ignore usage-limit bot comments.

## 5. Drain review comments to all-clear

Treat inline review threads as work. Loop until the
stop condition.

On each loop:

1. List unresolved review threads and new review
   comments on the PR. Include bot reviews (Bugbot,
   Security Reviewer, and similar).
2. Ignore Codex and Bugbot **usage-limit** issue
   comments. Those are not code review. A Cursor
   Approval Agent "not approving because Bugbot
   skipped" note is also not a review finding.
3. For each remaining comment, either fix it or record
   a brief reason that the repo rules reject it.
4. For every tracked drain fix, run **Gates**, commit,
   and push. Use red-green TDD only for a behavior
   change. After a drain commit that changes behavior
   or the spec, adds or removes a file, or changes an
   axis's reviewed input, return to §4b and reach
   consensus again before you continue the drain. A
   wording-only edit in an existing file does not
   return to §4b.
5. Resolve only the threads that the new commit
   actually fixes. In Cursor Cloud, resolve through the
   pull-request tool, not a merge command.
6. Wait for every required check in **CI** *(binding)*
   to finish, plus any required bot reviews on the PR.
   Subscribe to CI and PR events when that tool exists.
   When it does not, the parent may use a wait with a
   deadline, for example
   `timeout 30m gh pr checks --required --watch`. Do
   not wait without a time limit. Do not wait on
   optional checks. Reviewers still do not poll.
7. Re-list unresolved threads and new comments after
   CI completes. Start this loop again when anything
   remains.

Do not post a "done" comment unless the user asks. Do
not leave a valid review thread open because the bot
is slow. Wait, then look again.

### Stop condition

Stop when all of these are true:

- **Gates** passed with no warnings on the last commit
- Required CI checks are green
- There are no unresolved review threads
- No new review comment arrived after the last push

Then report the PR URL, the slice heading, and that the
comment drain is all-clear. Do not merge unless the
user explicitly asks to merge.

## What not to do

- Do not write code against a new spec or design note
  before the user approves that document.
- Do not substitute a different plan-review model when
  a named Cursor model is unavailable.
- Do not require Cursor Task slugs on Claude Code or
  Codex.
- Do not require a test file or a RED run at plan
  review.
- Do not send Sol or Opus the full tree, full **Rules**
  files, or "read this 9k-line file." Brief + real
  plan/diff + the rule excerpt that applies. Complete
  files inside that diff are allowed.
- Do not send Grok a truncated plan at patch review.
- Do not require fabricated RED evidence on a
  non-behavior slice.
- Do not add a fourth review model.
- Do not re-run all three models on a wording nit.
  Resume the objector with the delta. Re-run any axis
  whose input changed.
- Do not resume patch review on an uncommitted fix,
  even a docs-only fix. Run **Gates**, commit, and push
  first.
- Do not ask reviewers to watch CI. The parent may
  poll when subscriptions are unavailable.
