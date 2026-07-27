---
name: fleet-efficiency
description: Context-handoff, prompt-cache, and model-tier rules for fanning out many subagents. Read BEFORE launching 3+ parallel agents, writing a Workflow script, or running audits, migrations, or multi-stage pipelines across many files. Every agent dispatch names its model explicitly.
---

# Fleet Efficiency (context handoff, no duplicate reads)

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

Right-size the harness before the models: a majority-vote refuter
panel is for audits and high-stakes sweeps, not for hardening a
small PR — there, one finder plus one verifier is the ceiling.
