# TDD Pipeline Methodology

## Overview

Seven-stage pipeline per module. Tests are written,
reviewed, and confirmed RED before implementation begins.

```
1. TEST WRITER (test-writer role)
     Writes ALL tests + type stubs for the module.
     Tests compile. No real implementation.
       |
2. TEST REVIEWER (test-reviewer role)
     Reviews tests for correctness and coverage.
       |
     fix loop: if issues found, continue the
     test-writer, then re-review until APPROVED
       |
3. RED GATE (orchestrator)
     Runs tests. ALL tests must FAIL. If any pass,
     the stubs are too complete -- continue the
     test-writer to fix. This proves the tests
     actually exercise the implementation.
       |
4. IMPLEMENTER (implementer role)
     Writes source code to make all tests pass.
     Cannot modify tests. Runs tests to confirm GREEN.
       |
5. VERIFY GATE (orchestrator)
     1. Module test command passes
     2. Source file > 30 lines (catches stubs)
     3. Lint clean
     4. Language-specific checks from the config
       |
6. CODE REVIEWER (code-reviewer role)
     Reviews implementation for correctness, resource
     management, code quality, and dependencies.
       |
     fix loop: if issues found, continue the
     implementer, then re-review until APPROVED
       |
7. INTEGRATE (orchestrator)
     Updates build files (if needed)
     Runs full test suite
     Commits
```

Every fix loop and gate has the same cap: 3 rounds,
then escalate to the user.

### Why the RED gate matters

If tests pass against stubs, they prove nothing. The
RED gate confirms every test will only pass when real
logic exists. Without it, you get false confidence:
tests that always pass regardless of implementation.

**Default-value trap**: a common failure mode is tests
that assert falsy values (false, nil, 0, "") against
stubs that return those same values by default. These
tests pass immediately and the RED gate cannot catch
them because the test "fails" for zero tests; it just
silently passes. The test-writer and test-reviewer
stages must prevent this upstream by choosing inputs
that require non-default return values or by testing
for truthy/non-zero results.

## Roles Reference

Each pipeline stage runs a role. The role prompts live
in the plugin's `agents/` directory:

| Stage | Role | Writes |
|-------|------|--------|
| 1. Tests + stubs | test-writer | test + stub files |
| 2. Test review | test-reviewer | nothing |
| 3. Red gate | (orchestrator) | nothing |
| 4. Implement | implementer | source files |
| 5. Verify gate | (orchestrator) | nothing |
| 6. Code review | code-reviewer | nothing |
| 7. Integrate | (orchestrator) | commit |

On Claude Code the roles are registered agents,
dispatched as `subagent_type: tdd-pipeline:<role>`. On
other harnesses the orchestrator briefs a subagent with
the role file's body, or plays the role itself when the
harness has no subagents.

There is no separate shared briefing skill. Each
writing role's "Agent Briefing" section (file rules,
shell rules, quality bar) is defined directly in
test-writer.md and implementer.md, which keep those
blocks in sync manually.

## Orchestrator Rules

The main context is a **pure dispatcher**. It:
- NEVER edits source or test files
- Dispatches roles for all code work
- Runs gate checks between stages
- Updates build files after approval
- Runs full integration tests before committing
- Escalates to the user after 3 rounds

## Agent Workflow

Agents write directly to the working directory. No
branches, no merges.

Test writers write ONLY test files (and minimal type
stubs). Implementers write ONLY source files. Neither
modifies build files. Neither commits.

Agents run the module test command specified in the
project's instructions file (`CLAUDE.md`, or
`AGENTS.md` when the configuration lives there).

## Red Gate

After test review, before implementation:

1. Run module test command
2. ALL tests must FAIL
3. If any test passes, stubs are too complete:
   continue the test-writer to remove real logic
   from stubs

## Verify Gate

After implementation, before code review:

1. Module test command passes
2. Source file > 30 lines (catches stubs)
3. Lint command passes (from the config)
4. Language-specific checks (from the config)

If any check fails: continue the implementer with
specific feedback. Do NOT waste a reviewer dispatch.

## Post-Review Pipeline

After code reviewer approves:
1. Orchestrator updates build files (if needed)
2. Orchestrator runs full test suite
3. Orchestrator commits

## Fix Loops

Both review stages and both gates use a fix loop:

1. Reviewer or gate reports the issues
2. Orchestrator continues the original author agent
   (test-writer or implementer) with the feedback,
   when the harness can resume an agent; otherwise it
   re-dispatches with the original brief plus the
   fix list
3. Reviewer re-reviews, or the gate re-runs
4. Maximum 3 rounds, then escalate to the user

## Running the Pipeline as a Dynamic Workflow

The stages above describe the **turn-by-turn** model: the
orchestrator dispatches one agent per turn and every result
lands in its context. Claude Code's dynamic workflows offer a
second execution model -- the orchestration moves into a
JavaScript script the runtime runs in the background, and only
the final result returns to context. The agents and the
discipline are identical; only the idiom changes.

Reach for a workflow when the full pipeline runs at scale (a
new module, or many modules/files in parallel). Keep the
turn-by-turn skill for inline bug fixes and 1-2 file changes --
a workflow's per-run agent fan-out is wasted on small
interactive work, and costs meaningfully more tokens (a trivial
3-behavior module ran ~6 agents / ~80k tokens end to end).

### Idiom translation

| Turn-by-turn (skill) | Workflow (script) |
|----------------------|-------------------|
| Dispatch `subagent_type: tdd-pipeline:implementer` | `agent(brief, {agentType: 'tdd-pipeline:implementer'})` |
| Orchestrator runs the gate command itself | A gate is an `agent()` -- the script has no shell |
| SendMessage to continue an agent | Re-`agent()`; resume/caching is runtime-provided |
| Fix loop, max 3 rounds | A `do/while` capped on the reviewer verdict |
| Reviewer returns prose findings | `agent(..., {schema})` returns a validated verdict |
| Stage 7: orchestrator commits | Workflow returns the result; commit happens outside |

### What stays the same

- **Agents are unchanged.** The four plugin agents are the
  workflow worker primitive; target them by qualified name via
  `agentType`. They honor their role constraints when
  workflow-driven exactly as under the skill.
- **The discipline transfers through the brief**, not through
  the skill prose. Inline the behaviors, the `path:line`
  targets, the test command, and the default-value-trap warning
  in each `agent()` call.
- **RED gate semantics.** A stub that raises (rather than
  returning a default) makes tests *error*, not *fail* --
  unittest, pytest, and `zig build test` all report these
  distinctly. Both count as valid RED: tests imported/compiled
  cleanly and none passed. Have the gate agent report
  passed/failed/errored counts so the script can assert
  "none passed."

### What changes

- **No commit inside the workflow.** Return the diff and the
  round-by-round review log; the orchestrator or human commits
  afterward. This preserves one-commit-per-phase and sidesteps
  signing-failure handling entirely.
- **Sign-off moves to the run boundary.** Workflows take no
  mid-run user input. For a human spot-check, run the phase as
  its own workflow and review its return value before
  committing.

### Open question

A workflow Claude *authors from scratch* only inherits this
discipline if the skill's content reaches the author. Whether
saying "workflow" in a TDD project auto-injects the
tdd-orchestrate skill into the authoring step, or yields a
generic TDD script that skips the RED gate, is unconfirmed.
Until verified, read the generated script (`Ctrl+G` at the
approval prompt) and confirm it targets the plugin agents and
runs the gates before trusting it.

## Composition with Language Plugins

This pipeline is language-agnostic. Language-specific
behavior comes from:

1. **Instructions file**: test commands, file patterns,
   lint rules, and language-specific checks
2. **Language plugins**: inject corrections into the
   instructions file (e.g. zig-claude-kit adds Zig
   0.15.x corrections)
3. **Agent briefing**: directs agents to read the
   instructions file for project-specific context

No coupling exists between this plugin and language
plugins at the code level. The instructions file is the
integration point.
