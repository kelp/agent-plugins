---
name: tdd-orchestrate
description: >
  Enforce strict red-green-refactor TDD for any task.
  Use when implementing features, fixing bugs, adding
  functionality, or building new modules. Routes to the
  full 7-stage pipeline for new modules with 3+ behaviors,
  or runs inline red-green-refactor for bug fixes and
  small changes. Triggers on: "use TDD", "fix this bug",
  "add a feature", "implement", "run the pipeline",
  "TDD pipeline", "build a module with TDD", or any
  coding task in a project with TDD in its CLAUDE.md.
  Agents inherit the session model; pass `--model <name>`
  to pin one for the run.
user-invocable: true
---

# /tdd-orchestrate

Strict red-green-refactor for every code change.

## Input

Task: $0

If no task was provided, ask the user what to implement
or fix. One sentence is enough.

## Model

Agents inherit your session model by default. Cheaper
models tend to fail the reviewer gates and loop, which
costs more wall-clock and tokens than a capable model
one-shotting the stage — so prefer a capable model for
this pipeline.

To pin a model regardless of session, pass `--model
<name>` in the task (e.g. `/tdd-orchestrate --model opus
parser`). Strip the flag from the task text before
briefing agents, then pass `model: <name>` to every
Agent dispatch in this skill (inline and full pipeline
alike). With no flag, omit `model:` so each agent
inherits the session model.

## Decide: Pipeline or Inline

A **behavior** is one discrete, independently testable
unit of functionality the module must exhibit (e.g. "the
parser rejects an empty string," "the cache evicts the
oldest entry"). Every later reference to "behavior" in
this skill and in the agent role files means this
definition — one item in the orchestrator's enumerated
behavior list for the task.

**Use the full pipeline** (see "Pipeline" section) when:
- Building a new module from scratch
- The task has 3+ distinct behaviors to implement
- The user explicitly asks for the pipeline

**Use inline red-green-refactor** when:
- Fixing a bug
- Adding a single feature or flag
- Modifying existing code
- The change touches 1-2 files

Most tasks are inline. Default to inline unless the
scope clearly warrants the full pipeline. **Precedence:
if any full-pipeline criterion applies, use the full
pipeline regardless of the file-count heuristic** — a
new module that happens to fit in one file is still a
full-pipeline task.

## Inline Red-Green-Refactor

**Precondition**: read the project's CLAUDE.md. If it
has no `## TDD Pipeline Configuration` section, stop and
tell the user to run `/tdd-pipeline:tdd-init` first.

Inline uses two agents and two commits. It skips the
reviewer stages and the stub/RED-gate dance, because
inline targets existing code where the test fails
against the bug directly (no stub to typecheck against).

You are still a dispatcher. Do NOT write source or test
files yourself. The orchestrator's job here is:

1. Brief the test-writer (RED).
2. Verify RED, commit the test.
3. Brief the implementer (GREEN).
4. Verify GREEN, commit the fix.

Use SendMessage to continue agents across stages when
useful (see "Continuation Strategy" below).

### Step 1: Understand (< 2 minutes, orchestrator-side)

Read the relevant source and test files just enough to
write a precise agent brief. Cite `path:line` for the
target. Identify the existing test pattern in the file
so the agent matches it. Do NOT write a plan document.

### Step 2: RED — Dispatch test-writer

Dispatch `subagent_type: tdd-pipeline:test-writer`
with:
- One sentence describing the bug.
- The target file and line.
- The test signature pattern to match (paste one
  existing test from the same file as an example).
- The exact assertion the new test should make.
- A clear stopping point: "write the test, verify it
  fails locally, report back. Do NOT commit; the
  orchestrator commits."

Run the project's test command yourself, confirm the
new test fails for the right reason (not a compile
error), commit the test with a message like
`Test ... (RED)` or `Add failing test for ...`.

**Watch for default-value traps.** If a test asserts a
falsy value (false, nil, 0, "") that the existing buggy
code already returns, the test passes for the wrong
reason. Reject and re-dispatch with a brief naming the
specific input that should produce a non-default result.

**The test must fail for the RIGHT reason.** A compile
error is not a valid red state — surface it and ask the
test-writer to fix the stubs.

**Cap re-dispatches.** If the RED gate fails twice in a
row for the same reason, do not re-dispatch a third
time. Stop. Report to the user: the module, the stage,
all rejection reasons from every round verbatim, and ask
whether to continue manually or change approach.

### Step 3: GREEN — Dispatch implementer

Dispatch `subagent_type: tdd-pipeline:implementer`
with:
- The RED commit SHA and the test name.
- The target source file and line range.
- The expected change in one paragraph (not "figure it
  out from the test" — be specific; you already know).
- A clear stopping point: "write the fix, verify all
  tests pass locally, report back. Do NOT commit."

Run the project's test command yourself, confirm all
tests pass (not just the new one), commit with a
message describing the fix.

### Step 4: REFACTOR (only if needed)

If the code is clear and clean, skip this step. If you
refactor, dispatch a fresh implementer with a brief
naming the specific cleanup; do not extend the GREEN
agent's scope.

### Repeat

If the task requires multiple bugs, repeat from step 1
for each. One bug = one RED + GREEN pair.

### Skip-reviewer applies here

Inline does NOT use the test-reviewer or code-reviewer
stages. The full test suite is your safety net. If a
bug is genuinely subtle (API design, security
boundary, concurrency), promote it to the full pipeline
instead — don't bolt reviewers onto inline.

## Common Mistakes

These are real mistakes from past sessions. Each one
wastes significant time.

**Don't test duplicated logic.** Your test must import
and call the production code. If your test reimplements
the logic it's supposed to verify, it proves nothing.

**Don't skip the red step.** Every test must fail before
you write implementation code. Writing the test and
implementation together means you don't know whether the
test catches regressions.

**Don't get stuck planning.** The plan is: write a
failing test. If you've spent more than 2 minutes
without creating or editing a test file, you're stalling.

**Don't assert default values against stubs.** If your
test checks that a function returns false and the stub
returns false by default, the test passes without any
implementation. Either test for a truthy/non-default
value, use inputs that force a non-default result, or
make the stub return a deliberately wrong value so the
test fails until real logic exists.

**Don't test the wrong file descriptor.** When testing
TTY behavior, verify which fd (stdin, stdout, stderr)
the code actually checks.

**Don't mock what you can call.** If the real code is
available and fast, call it. Mocks diverge from
production and hide bugs.

See also "Common Mistakes" above — it applies to the
full pipeline too, not just inline.

---

## Full Pipeline

Use this section when the routing decision above chose
the full pipeline. For inline tasks, ignore everything
below.

**Precondition**: read the project's CLAUDE.md. If it
has no `## TDD Pipeline Configuration` section, stop and
tell the user to run `/tdd-pipeline:tdd-init` first.

### Pipeline Input

If the task specifies a module name, use it. Otherwise,
ask the user for the module name and behavior list (see
the behavior definition in "Decide: Pipeline or Inline").

Example: `/tdd-orchestrate parser`

## The Rule

**You are a PURE DISPATCHER. You NEVER write code.**

Violations you MUST NOT commit:
- Writing or editing any source or test file
- Fixing compiler errors or test failures directly
- Modifying code "just to unblock" something
- Making "small" fixes that "aren't worth an agent"
- Skipping any stage of the pipeline

What you DO:
- Dispatch the correct plugin agent for each stage
- Run verify gate checks between stages
- Update build files after approval (if needed)
- Run full test suite and commit
- Escalate to user after 3 agent rejections

If you catch yourself about to use Write or Edit on
a source or test file, STOP. Dispatch an agent.

## Red Flags -- You Are Skipping the Full Pipeline

These are violations of the **full pipeline**. If
inline is the correct routing (see "Decide" above),
several are legitimate inline behaviors; promote to
the full pipeline only when scope justifies it.

- "I'll write both tests and code in one agent" — not
  even inline does this; inline still separates RED
  and GREEN into two agent dispatches.
- "This module is simple enough to skip review" — true
  for inline; never true for a new module.
- "Let me just fix this one test real quick" — STOP.
  Dispatch an agent even for one-line fixes.
- "The test-writer can also stub the implementation"
  — STOP. The test-writer never writes real impl.
- "We don't need to run tests before implementing" —
  STOP. The RED gate is non-negotiable.
- "The stubs are trivial, RED gate is unnecessary" —
  STOP. The gate exists to catch stubs containing
  accidental real logic.

In all cases: if you'd be using Write or Edit yourself
on a source or test file, STOP. Dispatch an agent.

## Dispatching Agents

Use the Agent tool with one of the plugin's four
role-specific agent types. The role instructions
are already baked into each agent's system prompt —
do NOT read or inject skill content; pass only the
module name, behavior list, type signatures, and
other dispatch inputs.

Agent types:
- `subagent_type: tdd-pipeline:test-writer` —
  writes tests and minimal type stubs
- `subagent_type: tdd-pipeline:test-reviewer` —
  reviews tests (read-only)
- `subagent_type: tdd-pipeline:implementer` —
  writes implementation code to pass tests
- `subagent_type: tdd-pipeline:code-reviewer` —
  reviews implementation (read-only)

The test-writer and implementer agents bundle the
file/shell/quality briefing; the reviewers do not,
since reviewers never write files.

If the task carried a `--model <name>` flag (see
"Model"), pass `model: <name>` on every Agent dispatch
below. Otherwise omit it and let agents inherit the
session model.

## Continuation Strategy

**Default to SendMessage, not fresh Agent dispatches,
inside any fix loop.**

When a reviewer reports NEEDS_FIXES, the just-finished
writer agent still exists. Continuing it with
SendMessage preserves all the context it has already
built up — the file layout it learned, the design doc
it read, the tests it just wrote. A fresh Agent dispatch
re-pays all that cost.

Use SendMessage when:
- A reviewer says NEEDS_FIXES and the original writer is
  still resumable.
- The Verify Gate fails and the implementer can fix the
  specific issue you identify.
- You need a small follow-up on a recently completed
  agent's work (same file, related change).

Use a fresh Agent dispatch when:
- The previous agent is no longer resumable.
- The work is genuinely independent (different file,
  unrelated bug).
- You want a clean-slate perspective — e.g. a second
  reviewer for a contested call.

Each completion notification reports the agent ID and
explicitly says "use SendMessage with to: '<id>' to
continue this agent." Capture and use it.

## Briefing Strategy

Agents pay a cold-start cost: they read CLAUDE.md, grep
the codebase, re-discover the layout you already know.
Every fact you inline in the brief is a tool call the
agent doesn't have to make.

**Inline rather than reference, within reason:**

- If the agent needs a 1-page design fact, paste it.
  Don't say "read docs/foo.md fully." Reading a 700-line
  doc costs the agent 5+ tool calls.
- Cite `path:line` for known targets. The agent goes
  straight there; no grep dance.
- Paste an existing test from the same file as a
  pattern example. The agent matches style without
  exploring the file.
- Quote relevant CLAUDE.md sections when the agent
  needs language-specific guidance (e.g. "Zig 0.16 uses
  `std.Io.File.stdout()`, not `std.io.getStdOut()`").

**Don't inline indiscriminately:**

- A full project tour belongs in CLAUDE.md, not in
  every brief. Let the agent's tools cover what changes
  per project.
- Don't paste hundreds of lines when a `path:line:line`
  span and one sentence suffice.

**Cap exploration:**

Tell agents "don't read more than N files; if you can't
find what you need, report back." Prevents 30-tool-call
discovery hikes when your brief was incomplete.

**Trust agent verification:**

If the agent verified the tests pass and reported the
counts, spot-check by running the test command once
yourself — don't ask the agent to re-verify. Trust but
verify.

## Pipeline

Read the project's CLAUDE.md for test commands, file
paths, and language-specific context. Every value
below marked with `(CLAUDE.md)` must come from there.

**Stage tracker**: before each agent dispatch below,
state which stage you are starting (e.g. "Stage 3: Red
Gate"). A resumed or compacted session can then recover
its place from the transcript alone.

### Stage 1: Test Writer

Announce "Stage 1: Test Writer." Dispatch
`subagent_type: tdd-pipeline:test-writer` with:
- Module name and behavior list
- Type signatures and dependency APIs
- Test command (CLAUDE.md)

Pass `model:` if the task carried a `--model` flag (see
"Model").

The agent writes the test file and type stubs to the
source file path (CLAUDE.md). Stubs contain only
signatures -- no real logic.

### Stage 2: Test Reviewer

Announce "Stage 2: Test Reviewer." Dispatch
`subagent_type: tdd-pipeline:test-reviewer` with:
- Module name and behavior list
- The test file path

Pass `model:` if the task carried a `--model` flag.

**Fix loop**: before each re-dispatch, create or update
a TodoWrite item, e.g. "Test review round 2/3," so the
round count stays visible. If NEEDS_FIXES, use
**SendMessage** to continue the original test-writer
agent with the reviewer's feedback as the fix list (see
"Continuation Strategy"). The writer already has the
design and file context — a fresh dispatch re-pays that
cost. Then re-dispatch the test-reviewer (clean
perspective on the fixed tests). Maximum 3 rounds; on
the 3rd rejection, stop. Report to the user: the module,
the stage, all rejection reasons from every round
verbatim, and ask whether to continue manually or change
approach.

### Stage 3: Red Gate

Announce "Stage 3: Red Gate." Run the module test
command (CLAUDE.md).

- Tests must COMPILE and all must FAIL at runtime.
- A compile error is NOT a pass -- re-dispatch the
  test-writer to fix stubs until tests compile.
- If any test passes, the stubs contain real logic.
  Re-dispatch the test-writer to strip stubs back
  to signatures only.

Only proceed when tests compile and all fail.

### Stage 4: Implementer

Announce "Stage 4: Implementer." Dispatch
`subagent_type: tdd-pipeline:implementer` with:
- Module name and behavior list
- Type signatures and dependency APIs
- Test command (CLAUDE.md)

Pass `model:` if the task carried a `--model` flag.

The agent replaces the stub source file with the
real implementation to make all tests pass.

### Stage 5: Verify Gate

Announce "Stage 5: Verify Gate." Run these checks
yourself (do NOT dispatch an agent):

1. Module test command passes (CLAUDE.md)
2. Source file > 30 lines (catches stubs -- adjust
   threshold per CLAUDE.md if your language is terse)
3. Lint command passes (CLAUDE.md)
4. Language-specific checks pass (CLAUDE.md)

If any check fails: use **SendMessage** to continue the
implementer with the specific failure (see
"Continuation Strategy"). Do NOT waste a reviewer
dispatch and do NOT spawn a fresh implementer — the
one that just finished still has the file loaded.

### Stage 6: Code Reviewer

Announce "Stage 6: Code Reviewer." Dispatch
`subagent_type: tdd-pipeline:code-reviewer` with:
- Module name and behavior list
- Source and test file paths

Pass `model:` if the task carried a `--model` flag.

**Fix loop**: before each re-dispatch, create or update
a TodoWrite item, e.g. "Code review round 2/3," so the
round count stays visible. If NEEDS_FIXES, use
**SendMessage** to continue the original implementer
agent with the reviewer's feedback as the fix list (see
"Continuation Strategy"). The implementer already has
the test file and implementation context loaded — a
fresh dispatch re-pays that cost. Then re-dispatch the
code-reviewer (clean perspective on the fixed code).
Maximum 3 rounds; on the 3rd rejection, stop. Report to
the user: the module, the stage, all rejection reasons
from every round verbatim, and ask whether to continue
manually or change approach.

### Stage 7: Integrate

Announce "Stage 7: Integrate." After code reviewer
approves:
1. Update build files if needed (CLAUDE.md)
2. Run full test command (CLAUDE.md)
3. Commit with a descriptive message
