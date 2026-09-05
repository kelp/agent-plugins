---
name: tdd-orchestrate
description: >
  Enforce strict red-green-refactor TDD for any task.
  Use when the user asks for TDD or the pipeline ("use
  TDD", "run the pipeline", "TDD pipeline", "build a
  module with TDD", "fix this bug with TDD"), or for any
  coding task in a project whose instructions file has a
  TDD Pipeline Configuration section. Routes to the full
  7-stage pipeline for new modules with 3+ behaviors, or
  runs inline red-green-refactor for bug fixes and small
  changes. Role agents default to Opus; pass `--model
  <name>` to pin another model for the run.
user-invocable: true
---

# /tdd-orchestrate

Strict red-green-refactor for every code change.

This skill is written for any agent harness. Where a
step depends on a harness feature (subagents, resuming
an agent, a model override), the text names the feature
and gives the Claude Code form as one example. Use your
harness's equivalent.

## Input

Task: $ARGUMENTS

`$ARGUMENTS` is the text after the skill name. If it is
empty, ask the user what to implement or fix. One
sentence is enough.

## Instructions File

The project's agent instructions file holds the pipeline
configuration under `## TDD Pipeline Configuration`.
Read `CLAUDE.md`; if that section is not there, read
`AGENTS.md`. If neither has it, stop and tell the user
to run `/tdd-init` first. Every value below marked
`(config)` comes from that section.

## Model

The four role files in `agents/` declare `model: opus`.
Claude Code honors that field; other harnesses use their
own subagent default. Cheaper models tend to fail the
reviewer gates and loop, which costs more wall-clock and
tokens than a capable model one-shotting the stage, so
keep a capable model on this pipeline.

To pin a model for one run, pass `--model <name>` in the
task (e.g. `/tdd-orchestrate --model opus parser`).
Strip the flag from the task text before briefing
agents, then pass that model on every subagent dispatch
in this skill, inline and full pipeline alike (Claude
Code: the Agent tool's `model:` parameter, which takes
precedence over the role file). With no flag, set no
model; the role file's default applies.

## Decide: Pipeline or Inline

A **behavior** is one discrete, independently testable
unit of functionality the module must exhibit (e.g. "the
parser rejects an empty string," "the cache evicts the
oldest entry"). Every later reference to "behavior" in
this skill and in the role files means this definition:
one item in the orchestrator's enumerated behavior list
for the task.

**Use the full pipeline** (see "Full Pipeline") when:
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
pipeline regardless of the file-count heuristic.** A
new module that happens to fit in one file is still a
full-pipeline task.

## Roles and Dispatch

Each stage runs one of four roles. The role prompts live
in `agents/`, beside `skills/` in the plugin directory
(`${CLAUDE_PLUGIN_ROOT}` on Claude Code):

- `test-writer` -- writes tests and minimal type stubs
- `test-reviewer` -- reviews tests (read-only)
- `implementer` -- writes implementation to pass tests
- `code-reviewer` -- reviews implementation (read-only)

How to dispatch depends on the harness:

- **Claude Code**: the roles are registered agents.
  Dispatch with the Agent tool and `subagent_type:
  tdd-pipeline:<role>`. Do not read or paste the role
  file; it is already the agent's system prompt.
- **Other harnesses with subagents**: start a subagent
  and put the role file's body (everything below the
  frontmatter) at the top of its brief, then the
  dispatch inputs.
- **No subagents**: play each role yourself, one stage
  at a time, and announce the role you are in. Keep
  every gate and every rule of the role you are playing.
  The separation is then a discipline instead of a
  mechanism, and the gates carry the weight.

Whatever the mechanism, pass only the dispatch inputs:
module name, behavior list, type signatures, dependency
APIs, test command, file paths. The role file carries
the rules.

The test-writer and implementer roles bundle the
file/shell/quality briefing; the reviewers do not,
since reviewers never write files.

## Continuation Strategy

**Inside any fix loop, continue the author agent instead
of starting a fresh one, when the harness can resume a
subagent** (Claude Code: `SendMessage` with the agent id
from its completion notice). The just-finished writer
still holds the file layout it learned and the tests it
just wrote. A fresh dispatch re-pays that cost.

Continue the agent when:
- A reviewer says NEEDS_FIXES and the author is still
  resumable.
- A gate fails and the author can fix the specific
  issue you identify.
- You need a small follow-up on a recently completed
  agent's work (same file, related change).

Dispatch a fresh agent when:
- The previous agent is no longer resumable, or the
  harness cannot resume agents at all. Re-send the
  original brief plus the fix list.
- The work is genuinely independent (different file,
  unrelated bug).
- You want a clean-slate perspective, e.g. a second
  reviewer for a contested call.

## Round Caps

Every fix loop in this skill, inline or full, has the
same cap: **3 rounds**. Before each round, record the
count where you track tasks (a todo item or a transcript
line such as "Test review round 2/3"). On the 3rd
failure of the same gate or review, stop. Report to the
user: the module, the stage, every rejection reason from
every round verbatim, and ask whether to continue
manually or change approach.

## Briefing Strategy

Agents pay a cold-start cost: they read the instructions
file, grep the codebase, re-discover the layout you
already know. Every fact you inline in the brief is a
tool call the agent doesn't have to make.

**Inline rather than reference, within reason:**

- If the agent needs a 1-page design fact, paste it.
  Don't say "read docs/foo.md fully." Reading a 700-line
  doc costs the agent 5+ tool calls.
- Cite `path:line` for known targets. The agent goes
  straight there; no grep dance.
- Paste an existing test from the same file as a
  pattern example. The agent matches style without
  exploring the file.
- Quote relevant instructions-file sections when the
  agent needs language-specific guidance (e.g. "Zig
  0.16 uses `std.Io.File.stdout()`, not
  `std.io.getStdOut()`").

**Don't inline indiscriminately:**

- A full project tour belongs in the instructions file,
  not in every brief. Let the agent's tools cover what
  changes per project.
- Don't paste hundreds of lines when a `path:line:line`
  span and one sentence suffice.

**Cap exploration:**

Tell agents "don't read more than N files; if you can't
find what you need, report back." Prevents 30-tool-call
discovery hikes when your brief was incomplete.

**Trust agent verification:**

If the agent verified the tests pass and reported the
counts, spot-check by running the test command once
yourself. Don't ask the agent to re-verify. Trust but
verify.

## Common Mistakes

These are real mistakes from past sessions. Each one
wastes significant time. They apply to inline and full
pipeline alike.

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

---

## Inline Red-Green-Refactor

Use this section when the routing decision chose inline.

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

### Step 1: Understand (< 2 minutes, orchestrator-side)

Read the relevant source and test files just enough to
write a precise agent brief. Cite `path:line` for the
target. Identify the existing test pattern in the file
so the agent matches it. Do NOT write a plan document.

### Step 2: RED -- Dispatch test-writer

Dispatch the test-writer role with:
- One sentence describing the bug.
- The target file and line.
- The test signature pattern to match (paste one
  existing test from the same file as an example).
- The exact assertion the new test should make.
- A clear stopping point: "write the test, verify it
  fails locally, report back. Do NOT commit; the
  orchestrator commits."

Run the test command (config) yourself, confirm the
new test fails for the right reason (not a compile
error), commit the test with a message like
`Test ... (RED)` or `Add failing test for ...`.

**Watch for default-value traps.** If a test asserts a
falsy value (false, nil, 0, "") that the existing buggy
code already returns, the test passes for the wrong
reason. Reject and continue the test-writer with a
brief naming the specific input that should produce a
non-default result.

**The test must fail for the RIGHT reason.** A compile
error is not a valid red state. Surface it and continue
the test-writer to fix it.

Each rejection is one round under "Round Caps."

### Step 3: GREEN -- Dispatch implementer

Dispatch the implementer role with:
- The RED commit SHA and the test name.
- The target source file and line range.
- The expected change in one paragraph (not "figure it
  out from the test"; be specific, you already know).
- A clear stopping point: "write the fix, verify all
  tests pass locally, report back. Do NOT commit."

Run the test command (config) yourself, confirm all
tests pass (not just the new one), commit with a
message describing the fix. If any test fails, continue
the implementer with the failure output; each failure
is one round under "Round Caps."

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
instead; don't bolt reviewers onto inline.

---

## Full Pipeline

Use this section when the routing decision chose the
full pipeline. For inline tasks, ignore it.

### Pipeline Input

If the task specifies a module name, use it. Otherwise,
ask the user for the module name and behavior list (see
the behavior definition in "Decide: Pipeline or Inline").

Example: `/tdd-orchestrate parser`

### The Rule

**You are a PURE DISPATCHER. You NEVER write code.**

Violations you MUST NOT commit:
- Writing or editing any source or test file
- Fixing compiler errors or test failures directly
- Modifying code "just to unblock" something
- Making "small" fixes that "aren't worth an agent"
- Skipping any stage of the pipeline

What you DO:
- Dispatch the correct role for each stage
- Run gate checks between stages
- Update build files after approval (if needed)
- Run full test suite and commit
- Escalate to the user after 3 rounds (see "Round
  Caps")

If you catch yourself about to edit a source or test
file, STOP. Dispatch an agent.

### Red Flags -- You Are Skipping the Full Pipeline

These are violations of the **full pipeline**. If
inline is the correct routing (see "Decide" above),
several are legitimate inline behaviors; promote to
the full pipeline only when scope justifies it.

- "I'll write both tests and code in one agent": not
  even inline does this; inline still separates RED
  and GREEN into two agent dispatches.
- "This module is simple enough to skip review": true
  for inline; never true for a new module.
- "Let me just fix this one test real quick": STOP.
  Dispatch an agent even for one-line fixes.
- "The test-writer can also stub the implementation":
  STOP. The test-writer never writes real impl.
- "We don't need to run tests before implementing":
  STOP. The RED gate is non-negotiable.
- "The stubs are trivial, RED gate is unnecessary":
  STOP. The gate exists to catch stubs containing
  accidental real logic.

In all cases: if you'd be editing a source or test
file yourself, STOP. Dispatch an agent.

### Stages

Read the instructions file for test commands, file
paths, and language-specific context. Every value
below marked `(config)` must come from there.

**Stage tracker**: before each dispatch below, state
which stage you are starting (e.g. "Stage 3: Red
Gate"). A resumed or compacted session can then recover
its place from the transcript alone.

#### Stage 1: Test Writer

Announce "Stage 1: Test Writer." Dispatch the
test-writer role with:
- Module name and behavior list
- Type signatures and dependency APIs
- Test command (config)

The agent writes the test file and type stubs to the
source file path (config). Stubs contain only
signatures, no real logic.

#### Stage 2: Test Reviewer

Announce "Stage 2: Test Reviewer." Dispatch the
test-reviewer role with:
- Module name and behavior list
- The test file path

**Fix loop**: if NEEDS_FIXES, continue the original
test-writer with the reviewer's feedback as the fix
list (see "Continuation Strategy"). Then dispatch a
fresh test-reviewer (clean perspective on the fixed
tests). "Round Caps" apply.

#### Stage 3: Red Gate

Announce "Stage 3: Red Gate." Run the module test
command (config).

- Tests must COMPILE and all must FAIL at runtime.
- A compile error is NOT a pass. Continue the
  test-writer to fix stubs until tests compile.
- If any test passes, the stubs contain real logic.
  Continue the test-writer to strip stubs back to
  signatures only.

Each failed check is one round under "Round Caps."
Only proceed when tests compile and all fail.

#### Stage 4: Implementer

Announce "Stage 4: Implementer." Dispatch the
implementer role with:
- Module name and behavior list
- Type signatures and dependency APIs
- Test command (config)

The agent replaces the stub source file with the
real implementation to make all tests pass.

#### Stage 5: Verify Gate

Announce "Stage 5: Verify Gate." Run these checks
yourself (do NOT dispatch an agent):

1. Module test command passes (config)
2. Source file > 30 lines (catches stubs; adjust the
   threshold per config if your language is terse)
3. Lint command passes (config)
4. Language-specific checks pass (config)

If any check fails: continue the implementer with the
specific failure (see "Continuation Strategy"). Do NOT
waste a reviewer dispatch and do NOT spawn a fresh
implementer; the one that just finished still has the
file loaded. Each failed check is one round under
"Round Caps."

#### Stage 6: Code Reviewer

Announce "Stage 6: Code Reviewer." Dispatch the
code-reviewer role with:
- Module name and behavior list
- Source and test file paths

**Fix loop**: if NEEDS_FIXES, continue the original
implementer with the reviewer's feedback as the fix
list (see "Continuation Strategy"). Then dispatch a
fresh code-reviewer (clean perspective on the fixed
code). "Round Caps" apply.

#### Stage 7: Integrate

Announce "Stage 7: Integrate." After the code reviewer
approves:
1. Update build files if needed (config)
2. Run full test command (config)
3. Commit with a descriptive message
