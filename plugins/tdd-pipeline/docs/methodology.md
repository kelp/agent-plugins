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
