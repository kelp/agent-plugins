# knowledge-forge

Claude Code plugin that makes a three-layer personal
knowledge base discoverable and writable from any
session.

## What it does

**Cross-session discoverability** — the `kb-research-
policy` skill is matched on demand via its description
when a research question arises, from any session. When
you ask "what do I know about X" or "check my notes on
Y", Claude follows a standard index-first retrieval
procedure using the qmd MCP server instead of guessing or
opening files blindly. You can also invoke it directly
with `/kb-research-policy`.

**Guided capture** — `/kb-capture` files content into
the right wiki bucket with correct frontmatter, today's
date, resolved source IDs, and a passing `just lint`
before reindexing.

The plugin delegates all deterministic work (reindex,
lint, validate) to the knowledge repo's own `justfile`.
It adds judgment — bucket classification, frontmatter
drafting, note quality — not code.

## Requirements

- A knowledge base structured like `~/code/knowledge`
  with a `justfile` and an `index/` directory.
- The `qmd` MCP server configured in Claude Code
  (provides `mcp__plugin_qmd_qmd__*` tools).
- `just` on your PATH inside the knowledge repo's
  environment.

## Installation

```
/plugin marketplace add kelp/agent-plugins
/plugin install knowledge-forge@agent-plugins
```

## Configuration (optional)

If your knowledge base is not at `~/code/knowledge`,
add this line to the relevant project's `CLAUDE.md`:

```
knowledge-base: $HOME/path/to/your/kb
```

See `docs/claude-md-fragment.md` for the full snippet.

## Skills

### kb-research-policy

Matched on demand via its description when research
questions arise; also invocable directly. Teaches the
four-step retrieval procedure: resolve path → read
index/ → search via qmd MCP → open full notes only
after shortlisting.

### /kb-capture

User-invocable slash command. Classifies and captures
content into the correct wiki bucket with verified
frontmatter, runs `just lint` as a gate, then
`just refresh` to reindex.

## Version

See `.claude-plugin/plugin.json` — the only
authoritative version source.
