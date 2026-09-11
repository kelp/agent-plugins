---
name: fleet-efficiency
description: How to brief, dispatch, and right-size subagents, plus the context-handoff, prompt-cache, and model-tier rules for agent fleets. Read BEFORE any Agent call: choosing an agent type or model, deciding whether a task is worth delegating, or when a delegated result comes back thin. Required before launching 3+ parallel agents, writing a Workflow script, or running audits, migrations, or multi-stage pipelines. Every agent dispatch names its model explicitly.
---

# Fleet Efficiency (delegation rules, context handoff)

## Any dispatch (one agent or many)

- Delegate work that is large and independent. Anything you can
  finish in a handful of tool calls, do inline. Never spawn an
  agent to double-check your own work.
- Pick the most specific agent type before falling back to
  `general-purpose`.
- Run independent subagents in parallel: one message, multiple
  Agent calls.
- Run subagents in the background and keep working. For a
  follow-up, continue a long-lived agent via SendMessage instead
  of spawning a fresh one.
- Brief the agent like a colleague who just walked in: goal,
  context, what has been ruled out, expected output shape, and
  a length cap if you want one.
- Verify what the agent did; never trust the summary blind.
- Forks (`subagent_type: "fork"`) always run on the parent
  model; `model` overrides are ignored.

## Fleets (3+ agents, Workflows, audits, migrations)

When fanning out many agents (audits, migrations, multi-stage
pipelines), the token bill lives in the subagents, not the main
thread. Rules:

- **Scout once, brief many.** The orchestrator (or one scout
  agent) builds the repo map / file partition ONCE; every worker
  gets an explicit file list scoped to its task. Never let N
  agents each rediscover the repo.
- **Shared preamble, identical bytes.** Put the shared brief
  (architecture nutshell, conventions, rubric) as a byte-identical
  block at the TOP of every fleet prompt, per-agent task at the
  BOTTOM. Identical prefixes hit the prompt cache across the
  whole fleet; a reordered or reworded brief pays full price N
  times.
- **Excerpt, don't point.** Paste the ten relevant lines into the
  prompt instead of "read CLAUDE.md first". A 9k-token doc read
  by 150 agents is >1M tokens. If a project has a condensed
  agent brief (e.g. `docs/agent-brief.md`), paste that.
- **Hand artifacts forward.** Every pipeline stage returns
  structured output (schema) carrying exactly what the next stage
  needs: code excerpts, file:line, diffs, commands run. A
  downstream agent re-reads source only when its JOB is to
  distrust the upstream one (adversarial verification);
  formatters, dedupers, and drafters should need zero file reads.
- **Continue, don't respawn.** For fix loops on the same
  artifact, SendMessage the original agent; its context is
  intact. Inside Workflow scripts (no continuation), include the
  prior diff and the reviewer's issue list in the fresh agent's
  prompt so it doesn't re-derive them.
- **Keep fleet prompts byte-stable.** No timestamps, run ids, or
  other volatile values inside prompts; they bust Workflow
  resume caching and cross-agent prompt caching. Pass volatile
  values via `args` and reference them once.
- **Don't optimize away independence.** Verifiers re-reading the
  code their finder cited is intentional redundancy; cut the
  briefing waste, not the adversarial checks.

## Model tiers (pass `model` explicitly on EVERY dispatch)

An unpinned agent inherits the session model — often the most
expensive tier. Every `Agent` call and every Workflow `agent()`
call names its model; every mechanical stage also sets
`effort: 'low'`.

- **sonnet** (default workhorse): search, extraction, summarizing,
  gate-runners (run a command, report counts), formatters,
  dedupers, executing a fully specified plan.
- **opus** (mid): implementation with real design decisions,
  ordinary debugging, standard code review, test writing from a
  detailed spec, refuter/verifier passes.
- **fable** (top, budget it): hardest design questions, subtle
  bug hunting, adversarial review of tricky code, cross-file
  refactor planning. A fleet of fable finders is almost always
  overkill — one fable judge over opus finders beats N fable
  finders.

When unsure, start cheap and escalate. Escalate-if-thin catches
thin results, not confidently wrong ones: for judgment-heavy work
(reviews, audits), start a tier higher or verify the claims you
will act on in the main thread first.

Right-size the harness before the models: a majority-vote refuter
panel is for audits and high-stakes sweeps, not for hardening a
small PR — there, one finder plus one verifier is the ceiling.
