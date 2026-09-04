# agent-plugins

Claude Code plugins by kelp:

- **zig-claude-kit** -- fixes Claude's broken Zig 0.15.x
- **tiger-style** -- applies TigerBeetle's Tiger Style to
  Zig projects
- **tdd-pipeline** -- enforces TDD across separate agents
- **cross-review** -- gets a second opinion from GPT-5.5
- **codex-pair** -- pairs with a persistent Codex partner
- **knowledge-forge** -- captures notes and routes
  retrieval for a personal knowledge base
- **fleet-efficiency** -- runs agent fleets: token rules
  for fan-out, and a two-lead operating procedure
- **next-todo** -- lands one GitHub child issue as one
  PR: plan review, TDD, draft PR, comment drain

## Install

```bash
/plugin marketplace add kelp/agent-plugins
```

## Plugins

### zig-claude-kit

Claude generates broken Zig 0.15.x code for 12 specific
patterns. This plugin corrects them by appending the right
patterns to your project's CLAUDE.md so every agent
reads them.

```bash
/plugin install zig-claude-kit@agent-plugins
```

Open a Zig project. The plugin detects Zig source files
and prompts you to run `/zig-init`. From that point,
Claude writes correct Zig.

**Commands:**
- `/zig-init` -- inject corrections into CLAUDE.md
- `/zig-patterns` -- quick reference with code examples
- `/zig-check` -- audit files for outdated API usage

### tiger-style

TigerBeetle's [Tiger Style][tiger] is an opinionated
methodology for safety-critical Zig: minimum two
assertions per function, no recursion, static memory
after init, snake_case with unit suffixes, 70-line
function limit, 100-column line limit. This plugin
auto-detects Zig projects and offers to apply Tiger
Style to them by appending the rules to your project's
CLAUDE.md.

[tiger]: https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md

```bash
/plugin install tiger-style@agent-plugins
```

Open a Zig project. The plugin detects Zig source files
and prompts you to run `/tiger-init`. From that point,
Claude follows Tiger Style in that project. Uninstall
the plugin if a particular Zig project should not follow
Tiger Style -- the SessionStart hook prompts in every
Zig project until then.

**Commands:**
- `/tiger-init` -- inject Tiger Style into CLAUDE.md
- `/tiger-patterns` -- quick reference with code
  examples (auto-discovered)
- `/tiger-check [file]` -- audit files for mechanical
  violations (fn > 70 lines, line > 100 cols, `usize`,
  recursion, compound asserts, unbounded `while (true)`)

### tdd-pipeline

Claude skips tests, writes stubs, and reviews its own
work. This plugin stops that. It splits every module
into seven stages across separate agents -- no single
agent both writes and reviews code.

```bash
/plugin install tdd-pipeline@agent-plugins
```

Run `/tdd-init` to configure your project, then
`/tdd-orchestrate parser` to build a module. Agents
inherit your session model; pass `--model <name>` (e.g.
`/tdd-orchestrate --model opus parser`) to pin one for
the run.

**The pipeline:**

```
1. Test Writer    write tests + type stubs (RED)
2. Test Reviewer  review tests, fix loop
3. Red Gate       confirm all tests fail against stubs
4. Implementer    write code to pass tests (GREEN)
5. Verify Gate    tests pass, no stubs, lint clean
6. Code Reviewer  review implementation, fix loop
7. Integrate      update build files, full tests, commit
```

The orchestrator -- your main Claude session --
dispatches agents and never writes code. Each agent receives a role skill that constrains
what it can touch. Language-specific context comes from
CLAUDE.md, not the plugin -- so the pipeline works with
any language.

### cross-review

A single model reviewing its own work misses bugs it
would catch in someone else's. This plugin runs
independent Claude and GPT-5.5 reviews, has each model
validate the other's findings against the actual code,
and merges the result into one prioritized fix list.

```bash
/plugin install cross-review@agent-plugins
```

Run `/cross-review` on uncommitted changes, or pass a
scope: `/cross-review src/parser.zig` or `/cross-review
last 2 commits`. Disputed findings are separated from
confirmed ones so humans can triage them.

**Flags:**
- `--quick` -- skip cross-validation, merge raw findings
- `--reconcile` -- let each model defend its disputed
  findings in one follow-up round
- `--model <name>` -- run the Claude-side agents on a
  specific model (e.g. `opus`) instead of the session
  model; the GPT side is set by your codex install

**Requirements:**
- [Codex CLI](https://github.com/openai/codex),
  authenticated for GPT-5.5 access
- [codex-plugin-cc](https://github.com/openai/codex-plugin-cc),
  OpenAI's Claude Code plugin that bridges Codex to
  Claude Code. It installs via its `openai-codex`
  marketplace and ships the companion script we call.
  By default the plugin looks for that script at
  `$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs`.
  If you installed codex-plugin-cc elsewhere, set
  `codex-script:` in your project CLAUDE.md to the
  actual path — for security, the resolved path must
  be under `$HOME/.claude/plugins/`.
- Node.js on `PATH` to run the companion script

Without these, `/cross-review` falls back to claude-only
mode and runs a single-model review.

### codex-pair

Pair programming with a persistent Codex partner. `/pair start`
pins a long-lived Codex thread; every `/pair` message, review,
and verdict after that flows through the same thread for the
rest of the session, so both sides keep full context. Claude
drives -- it edits files -- while Codex navigates, reviewing in
a read-only sandbox. State lives in
`~/.claude/codex-pair/pairs.json` so `/pair resume` reattaches
the thread after a restart. The GPT side is set by your codex
install; override per pair with the wrapper's `--model` flag.

This complements cross-review: cross-review is a one-shot
second opinion, codex-pair is a continuous partner that
remembers the whole conversation.

Since v0.3.0 the workflow is first-class: an agreed design
artifact lives in the repo (`.codex-pair/design-<label>.md`)
and reviews are gated on it; design and review round caps
are enforced mechanically, with user overrides recorded in
state; and a deterministic snapshot command captures
staged, unstaged, and untracked changes without touching
the index. Since v0.4.0 a Fable judge rules on deadlocks:
when a round cap is reached (or you call `/pair judge`), a
third model reads the contested points and the code and
says who is right. The ruling is advisory and recorded in
state; you still decide whether the session continues.

```bash
/plugin install codex-pair@agent-plugins
```

**Commands:**
- `/pair start [label]` -- pin a new long-lived Codex thread
- `/pair design <topic>` -- iterate on a design with the
  partner until both sides agree; the result is written to
  `.codex-pair/` and hash-pinned
- `/pair <message>` -- send a message to the pinned thread
- `/pair review` -- ask Codex to review in a read-only sandbox
- `/pair judge` -- have a Fable judge rule on a deadlock
  between Claude and the partner
- `/pair resume [label]` -- reattach to a pinned thread after
  a restart
- `/pair status` -- show the active thread and its state
- `/pair end [label]` -- close out a pinned thread

The skill drives these through internal wrapper subcommands
(design-register, design-agree, design-amend, review-start,
review-complete, override-cap, judge, snapshot).

**Requirements:**
- [Codex CLI](https://github.com/openai/codex) >= 0.145,
  authenticated
- Node.js on `PATH`
- macOS or Linux (the wrapper uses POSIX process groups)

### knowledge-forge

Cross-session routing and capture for a three-layer
personal knowledge base. An auto-discovered policy skill
teaches Claude to check the knowledge base index first
before answering retrieval questions. Two slash commands
write into the base.

```bash
/plugin install knowledge-forge@agent-plugins
```

**Commands:**
- `/kb-capture` -- file the current conversation,
  source, or synthesis into the right wiki bucket with
  correct frontmatter and citations
- `/kb-ingest <url>` -- crawl an external documentation
  site into the knowledge base as a doc pack and source
  note

This plugin is built around a specific personal-KB
layout. Useful as a reference for plugins that integrate
with a per-user knowledge store; adapt the paths and
bucket conventions if you adopt it.

### fleet-efficiency

Two skills for running agent fleets.

`fleet-efficiency` loads before large parallel agent
dispatches, Workflow scripts, audits, and migrations:
scout once and brief many, keep fleet prompts
byte-identical for the prompt cache, hand structured
artifacts between pipeline stages, and name a model tier
on every dispatch.

`fleet-lead` runs the sessions above the fan-out. A drive
lead claims work units, signs commits, and opens PRs; a
gate lead watches CI, drains review threads, reads
heartbeats, and restarts a dead unit from the ledger.
Only a main loop can sign a commit, and a session stalled
at that gate looks exactly like a session doing work.
Claiming a unit runs a file-disjointness check against
everything in flight; shared-code units run alone.

```bash
/plugin install fleet-efficiency@agent-plugins
```

No commands, hooks, or agents; both skills are
model-invoked. The model-tier names (sonnet, opus,
fable) assume Anthropic's current lineup; adjust the
skill text if yours differs. `fleet-lead` expects the
project to define its ledger, unit definition, worktree
root, caps, gates, and pipelines.

### next-todo

Land one GitHub child issue as one pull request. The
plugin is the operating procedure: choose the next child
issue, write a plan, review it to consensus, implement with red-green
TDD, open a draft pull request, and drain review
comments until CI is green. A project supplies seven
binding values in its own CLAUDE.md.

```bash
/plugin install next-todo@agent-plugins
```

Run `/next-todo-init` to append the binding template,
fill in the values, then `/next-todo` (or
`/next-todo <issue-number>`).

**Commands:**
- `/next-todo [issue-number]` -- land one GitHub child
  issue as one PR
- `/next-todo-init` -- inject the binding template into
  CLAUDE.md

Plan and patch review use three axes (Grok, Sol, Opus
5) unless the binding names replacements. A
non-behavior exception uses Sol only.

## Composition

CLAUDE.md connects these plugins:

1. `zig-claude-kit` appends Zig 0.15.x corrections
2. `tiger-style` appends Tiger Style guidance
3. `tdd-pipeline` reads test commands and file patterns
4. `cross-review` reads the codex script path and
   optional review focus
5. `knowledge-forge` reads the `knowledge-base:` path
   from the active project CLAUDE.md
6. `next-todo` reads the Next TODO binding (backlog,
   plan, spec, gates, CI, review axes, rules)

## License

Public domain.
