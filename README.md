# agent-plugins

Claude Code plugins by kelp:

- **zig-claude-kit** -- fixes Claude's broken Zig 0.15.x
- **tiger-style** -- applies TigerBeetle's Tiger Style to
  Zig projects
- **tdd-pipeline** -- enforces TDD across separate agents
- **cross-review** -- native reviews from Claude, Codex,
  and/or Grok
- **pair** -- pairs with Codex, Grok, or Claude
- **knowledge-forge** -- captures notes and routes
  retrieval for a personal knowledge base
- **fleet-efficiency** -- runs agent fleets: token rules
  for fan-out, and a two-lead operating procedure
- **next-issue** -- lands one GitHub sub-issue as one
  PR, or one parent issue's remaining sub-issues as a
  stack

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

Coding agents skip tests, write stubs, and review their
own work. This plugin stops that. It splits every module
into seven stages across separate agents -- no single
agent both writes and reviews code.

```bash
/plugin install tdd-pipeline@agent-plugins
```

Run `/tdd-init` to configure your project, then
`/tdd-orchestrate parser` to build a module. Role
agents default to Opus; pass `--model <name>` (e.g.
`/tdd-orchestrate --model opus parser`) to pin another
model for the run. The skill text is harness-agnostic:
Claude Code dispatch is the worked example, and the
skill names the equivalent step for other harnesses.

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

Native reviews from Claude (`/code-review`), Codex
(`codex review` via app-server), and Grok (`/review`).
Name one harness or any set. Same-harness reviews stay
in-process. Foreign reviews go through a warm process
pool so the second call in a repo skips cold start.

```bash
/plugin install cross-review@agent-plugins
```

```
/cross-review
/cross-review grok
/cross-review grok claude --target branch:main
```

**Requirements:** the `claude`, `codex`, and/or `grok`
CLIs on PATH for the callees you want. Missing binaries
are skipped. Node.js is required for the pool CLI.

### pair

Pair programming with a persistent navigator on Codex, Grok,
or Claude. `/pair start --harness grok` pins a warm session;
later sends are turns, not boots. The current session drives
(edits, tests). The named harness navigates read-only. Default
navigator is Codex. You cannot pair with yourself.

Previously `codex-pair`. Uninstall that plugin and install
`pair@agent-plugins`. Existing `~/.claude/codex-pair/` state
and `.codex-pair/` design files are still read.

This complements cross-review: cross-review is a one-shot
native review; pair is a continuous partner.

Since v0.3.0 the workflow is first-class: an agreed design
artifact lives in the repo (`.pair/design-<label>.md`)
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
/plugin install pair@agent-plugins
```

**Commands:**
- `/pair start [--harness grok|claude|codex] [label]` --
  pin a navigator session
- `/pair design <topic>` -- iterate on a design with the
  partner until both sides agree; the result is written to
  `.pair/` and hash-pinned
- `/pair <message>` -- send a message to the pinned thread
- `/pair review` -- ask the navigator to review a snapshot
- `/pair judge` -- have a Fable judge rule on a deadlock
  (Claude as driver only)
- `/pair resume [label]` -- reattach to a pinned thread after
  a restart
- `/pair status` -- show the active thread and its state
- `/pair end [label]` -- close out a pinned thread

The skill drives these through internal wrapper subcommands
(design-register, design-agree, design-amend, review-start,
review-complete, override-cap, judge, snapshot).

**Requirements:**
- The navigator CLI on PATH: `codex`, `grok`, and/or
  `claude`
- Node.js on `PATH`
- macOS or Linux (the exec fallback uses POSIX process
  groups)
- For Codex as navigator, [Codex CLI](https://github.com/openai/codex)
  >= 0.145, authenticated

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

### next-issue

Land one GitHub child issue as one pull request. The
plugin is the operating procedure: choose the next child
issue, write a plan, review it to consensus, implement with red-green
TDD, open a draft pull request, and drain review
comments until CI is green. A project supplies seven
binding values in its own CLAUDE.md.

```bash
/plugin install next-issue@agent-plugins
```

Run `/next-issue-init` to append the binding template,
fill in the values, then `/next-issue` (or
`/next-issue <issue-number>`). Previously `next-todo`.
`/next-parent` runs `/next-issue` once per remaining
open sub-issue of one parent issue.

**Commands:**
- `/next-issue [issue-number]` -- land one GitHub
  sub-issue as one PR
- `/next-parent [parent]` -- land one parent issue's
  remaining sub-issues, one `/next-issue` run each
- `/next-issue-init` -- inject the binding template into
  CLAUDE.md

Plan and patch review use three axes (Grok, Sol, Opus
5) unless the binding names replacements. A
non-behavior exception uses Sol only.

## Composition

CLAUDE.md connects these plugins:

1. `zig-claude-kit` appends Zig 0.15.x corrections
2. `tiger-style` appends Tiger Style guidance
3. `tdd-pipeline` reads test commands and file patterns
4. `cross-review` and `pair` call the `claude`, `codex`,
   and `grok` CLIs on PATH through a warm process pool
5. `knowledge-forge` reads the `knowledge-base:` path
   from the active project CLAUDE.md
6. `next-issue` reads the Next issue binding (backlog,
   plan, spec, gates, CI, review axes, rules)

## License

Public domain.
