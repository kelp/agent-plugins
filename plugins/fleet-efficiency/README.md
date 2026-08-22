# fleet-efficiency

Claude Code plugin for running agent fleets: how to keep
a fan-out cheap, and how to run the leads above it.

## What it does

Two auto-discovered skills, matched via their
descriptions.

### fleet-efficiency

Loads whenever a session is about to launch 3+ parallel
agents, write a Workflow script, or run an audit,
migration, or multi-stage pipeline across many files. It
carries three rule sets:

**Context handoff** -- scout once and brief many instead
of letting N agents rediscover the repo; paste relevant
excerpts into prompts instead of pointing at files; hand
structured artifacts forward between pipeline stages;
continue an existing agent rather than respawning one.

**Prompt caching** -- keep the shared brief byte-identical
at the top of every fleet prompt, and keep prompts
byte-stable (no timestamps or run ids) so Workflow resume
and cross-agent prompt caching hold.

**Model tiers** -- every agent dispatch names its model
explicitly; sonnet for mechanical work, opus for ordinary
implementation and review, fable budgeted for the hardest
judgment calls.

### fleet-lead

Loads when a session starts or joins a fleet, claims or
releases a work unit, or finds a unit that stopped
reporting. Two long-lived leads share one repo: a drive
lead claims units, signs commits, and opens PRs; a gate
lead watches CI, drains review threads, reads heartbeats,
and restarts a dead unit from the ledger.

It exists because only a main loop can sign a commit, and
a session stalled at that gate is indistinguishable from
a session doing work. The skill covers unit claiming with
a file-disjointness check, concurrency caps, the
heartbeat and its death signals, and restart from the
ledger rather than from the dead session's context.

A project supplies six binding values (ledger, unit
definition, worktree root, caps, gates, pipelines) in its
own `CLAUDE.md`; the skill lists them.

## Installation

```
/plugin marketplace add kelp/kelp-claude-plugins
/plugin install fleet-efficiency@kelp-claude-plugins
```

No configuration beyond the project binding above. Both
skills are model-invoked; there are no slash commands,
hooks, or agents.
