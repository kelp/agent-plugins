# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code)
when working with code in this repository.

## What This Repo Is

A Claude Code plugin marketplace containing these plugins:

- **zig-claude-kit** -- corrective context for Zig that
  fixes Claude's outdated training data; auto-detects
  0.15.x vs 0.16.x and uses the matching reference
- **tiger-style** -- TigerBeetle's Tiger Style methodology
  for Zig (assertions, bounded loops, static memory,
  snake_case naming, 70-line / 100-col limits)
- **tdd-pipeline** -- language-agnostic TDD pipeline:
  four agent roles across a seven-stage pipeline (the
  red/verify/integrate gates run in the orchestrator,
  not as separate agents)
- **cross-review** -- native reviews from Claude, Codex,
  and/or Grok (any set), via a warm process pool
- **pair** -- pair with a persistent Codex, Grok, or
  Claude navigator; Fable judge when Claude drives
- **knowledge-forge** -- cross-session routing and
  capture for a three-layer personal knowledge base
- **fleet-efficiency** -- agent-fleet rules and
  procedure: context-handoff, prompt-cache, and
  model-tier rules for fanning out many subagents, plus
  the two-lead operating procedure above the fan-out
- **next-issue** -- land one GitHub child issue as one
  PR: plan review to consensus, red-green TDD, draft PR,
  comment drain; project bindings live in CLAUDE.md

Users install via `/plugin marketplace add kelp/agent-plugins`,
then `/plugin install <name>@agent-plugins`.

## Repository Structure

```
.claude-plugin/marketplace.json    # plugin registry
plugins/
  zig-claude-kit/
    .claude-plugin/plugin.json     # manifest (version here)
    skills/                        # zig-init, zig-patterns, zig-check
    hooks/hooks.json               # SessionStart hook
    scripts/                       # eval suite, session-start,
                                   #   detect-zig-version
    docs/0.15/                     # fragment, breaking changes ref
    docs/0.16/                     # fragment, breaking changes ref
  tiger-style/
    .claude-plugin/plugin.json     # manifest (version here)
    skills/                        # tiger-init, tiger-patterns, tiger-check
    hooks/hooks.json               # SessionStart hook
    scripts/                       # session-start
    docs/                          # fragment, reference doc
  tdd-pipeline/
    .claude-plugin/plugin.json     # manifest (version here)
    skills/                        # tdd-orchestrate, tdd-init
    agents/                        # test-writer, test-reviewer,
                                   #   implementer, code-reviewer
    docs/                          # fragment, methodology ref
  cross-review/
    .claude-plugin/plugin.json     # manifest (version here)
    skills/cross-review/           # orchestrator skill
    scripts/                       # harness pool CLI + broker
    agents/                        # legacy custom-schema roles
    docs/                          # fragment, merge/output ref
  pair/
    .claude-plugin/plugin.json     # manifest (version here)
    skills/pair/                   # orchestrator skill
    scripts/                       # pair CLI; warm pool via
                                   #   cross-review harness broker
    tests/                         # cli.test.mjs, lib.test.mjs
  knowledge-forge/
    .claude-plugin/plugin.json     # manifest (version here)
    skills/                        # kb-capture, kb-ingest,
                                   #   kb-research-policy
    docs/                          # fragment
  fleet-efficiency/
    .claude-plugin/plugin.json     # manifest (version here)
    skills/                        # fleet-efficiency (fan-out
                                   #   rules), fleet-lead (two-lead
                                   #   procedure); both auto-discovered
  next-issue/
    .claude-plugin/plugin.json     # manifest (version here)
    skills/                        # next-issue, next-issue-init
    docs/                          # CLAUDE.md binding fragment
```

## Key Conventions

### Plugin Variables

Skills use these Claude Code plugin variables:
- `${CLAUDE_PLUGIN_ROOT}` -- absolute path to the plugin
  directory at runtime
- `$0`, `$1`, `$ARGUMENTS` -- user arguments passed to
  user-invocable skills

### Version Management

Version lives only in each plugin's
`.claude-plugin/plugin.json`. The marketplace.json must
NOT contain version fields -- Claude Code silently
overrides them from plugin.json anyway.

All plugins use 0.x semver (pre-stable).

### SKILL.md Format

Skills use YAML frontmatter with these fields:
- `description` -- required
- `name` -- optional; derived from the skill directory
  when omitted. The zig-* and tiger-* skills omit it on
  purpose -- do not "fix" them by adding it.
- `user-invocable: true` -- for slash commands
- `disable-model-invocation: true` plus `argument-hint`
  -- for user-only audit skills (`zig-check`,
  `tiger-check`) that must never auto-invoke
- Agent role skills omit `user-invocable` (injected into
  agent prompts by the orchestrator, not called directly)

### Plugin Wiring Rules

Each of these caused a real bug; none is guessable:

- Never add a `hooks` field to plugin.json.
  Auto-discovery loads `hooks/hooks.json`; an explicit
  reference double-loads the hook (d249f39).
- The zig-claude-kit SessionStart hook's idempotency
  marker is the fragment's own heading (`## Zig
  0.1N.x Training Corrections`). Change a fragment's
  heading without updating the grep in session-start.sh
  and the hook re-fires every session.
- cross-review native reviews need `claude`, `codex`,
  and/or `grok` on PATH. Do not route them through the
  Codex companion `task` path.
- Model ids and the codex dependency name appear in
  README, CLAUDE.md, plugin.json, and SKILL.md. Update
  all four in one pass; partial renames have shipped
  stale warnings before (53742a7, bb20f65).

### Composition Model

CLAUDE.md is the integration point between plugins.
Language plugins (zig-claude-kit) append corrections.
Process plugins (tdd-pipeline, next-issue) read test
commands, file patterns, and bindings.

`pair` locates the cross-review harness broker at
runtime (sibling plugin, cache, or
`HARNESS_LIFECYCLE`). That is the one code-level
coupling. Do not add more.

## Heads-up: edit here, not the installed copies

This repo (`~/code/agent-plugins`) is the only place to
edit. Claude Code keeps two other copies that look editable but
aren't the source:

- `~/.claude/plugins/marketplaces/agent-plugins/` — a
  plugin-system-managed clone; local edits there fight the next
  marketplace update.
- `~/.claude/plugins/cache/agent-plugins/<plugin>/<ver>/` —
  what running sessions actually load.

Changes take effect only after bumping the plugin's version in
`.claude-plugin/plugin.json`, committing/pushing, and updating the
marketplace. For same-machine testing before release, mirror the
edited files into the current version's cache dir (they'll be
overwritten by the next real update, harmlessly).

## Zig Plugin Eval Suite

Run from `plugins/zig-claude-kit/`:

```bash
make eval                              # test all models
make eval-model MODEL=claude-haiku-4-5 # test one model
make compile-test MODEL=claude-sonnet-4-6 VERSION=0.15
make audit      # alias for audit-015; audit-016 and
                # audit-all also exist
```

Requires `ANTHROPIC_API_KEY` and `uv`.

## Gotchas

- `strict` in marketplace.json differs per plugin on
  purpose (true for zig-claude-kit and tiger-style,
  false for the rest). Don't blanket-change it.
- `.worktrees/` holds stale plugin copies; never treat
  its contents as canonical.
- The tdd-pipeline's known failure mode is the
  default-value trap: a test asserting a falsy value
  (`false`, `nil`, `0`, `""`) against a stub returning
  that same default passes immediately and never goes
  red. The pipeline docs carry guidance (ddf7c0c); keep
  it when editing them.

## Writing Style

Follow Strunk & White: omit needless words, use active
voice, make definite assertions. Wrap markdown at 78
characters.
