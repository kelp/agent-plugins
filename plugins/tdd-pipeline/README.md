# tdd-pipeline

Coding agents skip tests, review their own work, and
write stubs that pass. This plugin enforces test-first
discipline with four agent roles across a seven-stage
pipeline.

## How It Works

The orchestrator, your main session, dispatches agents
and runs the gates. It reads the project's instructions
file and, for inline work, just enough source to write a
precise brief. It never writes source or test files
itself.

**Full pipeline** (new modules, 3+ behaviors): seven
stages from test-writing through integration. See
[Methodology](docs/methodology.md) for the stage
diagram.

**Inline fast-track** (bug fixes, small changes):

```
1. Brief test-writer for the failing test
2. Verify RED locally, commit
3. Brief implementer for the fix
4. Verify GREEN locally, commit
```

Inline still uses two agents and two commits. RED and
GREEN are never combined. It skips the reviewer stages
and the stub/RED-gate dance, because the test fails
against the real bug, not against a stub.

The RED gate (full pipeline) catches a common failure:
stubs that contain real logic. Tests against such stubs
always pass, proving nothing. Every test must fail
before implementation begins.

Fix loops continue the original writer agent when the
harness can resume one, so the context it built up is
kept. Every loop, inline or full, stops after 3 rounds
and escalates to you.

## Harnesses

The skill text is harness-agnostic. Each step that needs
a harness feature names the feature and gives the Claude
Code form as one example:

| Feature | Claude Code | Elsewhere |
|---------|-------------|-----------|
| Dispatch a role | `subagent_type: tdd-pipeline:<role>` | brief a subagent with `agents/<role>.md` |
| Resume an agent | `SendMessage` | resume if supported, else re-dispatch with the fix list |
| Pin a model | Agent tool `model:` | the harness's model override |
| Config location | `CLAUDE.md` | `CLAUDE.md` or `AGENTS.md` |

A harness with no subagents plays each role in turn and
keeps every gate.

## Install

On Claude Code:

```bash
/plugin marketplace add kelp/agent-plugins
/plugin install tdd-pipeline@agent-plugins
```

On another harness, install `skills/tdd-orchestrate` and
`skills/tdd-init` where that harness discovers skills,
and keep `agents/` beside `skills/` so the orchestrator
can read the role files.

## Setup

1. Run `/tdd-init` to add a configuration template to
   your project's `CLAUDE.md` (or `AGENTS.md`)
2. Fill in test commands, file patterns, and lint rules

## Use

```
/tdd-orchestrate parser
```

The orchestrator reads your instructions file for
project specifics, then drives all seven stages. Role
agents default to Opus; pass `--model <name>` to pin
another model for the run.

## Composition

This plugin defines the process. Your instructions file
defines project specifics, and language plugins append
corrections.

Example with Zig:
1. Install `zig-claude-kit`, run `/zig-init`
2. Install `tdd-pipeline`, run `/tdd-init`
3. Fill in test commands and file patterns
4. Run `/tdd-orchestrate` for each module

The instructions file is the only integration point
between plugins.

## Skills

**User-invocable:**
- `tdd-orchestrate` -- drive the 7-stage pipeline
- `tdd-init` -- add config template to the instructions
  file

**Agent roles** (role prompts in `agents/`, dispatched
by the orchestrator):
- `test-writer` -- write tests and type stubs
- `test-reviewer` -- review tests for correctness
- `implementer` -- write implementation code
- `code-reviewer` -- review implementation

Each role file carries its own "Agent Briefing"
section (file rules, shell rules, quality bar). There is
no separate shared briefing skill; test-writer.md and
implementer.md keep their briefing blocks in sync
manually.

## Reference

- [Methodology](docs/methodology.md) -- pipeline
  stages, gates, fix loops
- [Config Fragment](docs/claude-md-fragment.md) --
  configuration template
