---
name: cross-review
description: >
  Native code review from Claude, Codex, and/or Grok. Call one
  harness or any set. Each callee uses its own reviewer. Triggers
  on: "cross-review", "review with grok", "ask Codex to review",
  "multi-harness review".
user-invocable: true
argument-hint: "[claude] [codex] [grok] [--target working-tree|branch:<ref>|commit:<sha>|pr:<n>]"
---

# /cross-review

Run each named harness's **native** reviewer. You are a dispatcher.
Do not edit source files. Do not fix findings.

## Arguments

Parse `$ARGUMENTS`:

- Harness names: `claude`, `codex`, `grok` (comma or space).
  Default: all three.
- `--target working-tree` (default), `branch:<ref>`,
  `commit:<sha>`, `pr:<n>`.
- `--base <ref>` is an alias for `--target branch:<ref>`.

If a harness binary is missing, skip it and say so. Do not fake
a review.

## Same-harness vs foreign

The current session is the driver.

- **This session is Claude Code** and `claude` is in the set:
  run `/code-review` here (no `--fix`, no `ultra`). Do not
  spawn a second Claude for that slot.
- **This session is Grok** and `grok` is in the set: run
  `/review` here (`--local`, `--branch`, or `--pr` to match
  `--target`).
- **This session is Codex** and `codex` is in the set: run
  `/review` here (uncommitted / `--base` / commit to match
  `--target`).

Every other callee goes through the pool CLI, in one call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/harness.mjs" review \
  --callees <comma-list-of-foreign-harnesses> \
  --target <target> \
  --cwd "<repo-root>"
```

The CLI starts a warm broker (Codex app-server, `grok agent`,
`claude -p` stream-json) and reuses it for later reviews in
this repo. Do not spawn `codex exec`, companion `task`, or ACP
adapters.

If the only callees were handled in-process, skip the CLI.

## Output

Print each harness's native findings, then the CLI `merged`
groups (same file, lines within 2). Keep `native.raw` available
if the user wants the verbatim review.

One callee: print that review. Do not invent a merge.

Never apply patches. Never call `/code-review --fix`.
