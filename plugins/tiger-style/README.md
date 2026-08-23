# tiger-style

Apply TigerBeetle's [Tiger Style][up] to Zig projects.
The plugin auto-detects Zig projects and prompts you to
install Tiger Style guidance into the project's
CLAUDE.md, so every Claude Code session in that project
follows the same rules.

[up]: https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md

## What It Applies

**Safety**

- Assertions: minimum two per function, paired across
  code paths, positive AND negative space, split
  compound asserts.
- Bounded loops; no recursion; `while (true)` must
  assert.
- Static memory only after init.
- All errors handled; brace multi-line `if`.

**Naming**

- `snake_case` for fn/var/file; no abbreviations.
- Acronyms keep caps (`VSRState`).
- Unit suffixes in descending significance
  (`latency_ms_max`).
- Callbacks last; `options: struct` for mixable args.

**Function Shape**

- Hard 70-line limit per function.
- Push `if`s up, push `for`s down.
- Centralize control flow.

**Formatting**

- `zig fmt`; 4-space indent; 100-column hard limit.

**Performance**

- Optimize the slowest resource first
  (network > disk > memory > CPU).
- Amortize via batching.
- Extract hot loops into standalone fns.

## Install

```bash
/plugin marketplace add kelp/agent-plugins
/plugin install tiger-style@agent-plugins
```

## Use

Open any Zig project. The plugin detects `build.zig`
(or `build.zig.zon`) at the project root and prompts
you to run `/tiger-style:tiger-init`. That command appends Tiger
Style guidance to your CLAUDE.md. Every agent reads it
as project context.

**Commands:**

- `/tiger-style:tiger-init` -- inject Tiger Style into CLAUDE.md
- `/tiger-style:tiger-patterns` -- quick reference with code
  examples (auto-discovered)
- `/tiger-style:tiger-check [file]` -- audit Zig files for
  mechanical violations

The session-start hook reminds you once per session in
any Zig project lacking Tiger Style guidance; it does not
block your request. If you never want the reminder,
uninstall the plugin.

## What `/tiger-style:tiger-check` Catches

Mechanical rules only:

- Functions longer than 70 lines
- Lines longer than 100 columns
- `usize` usage (suggest `u32`/`u64`)
- Direct recursion
- `assert(a and b)` compound asserts
- Bare `while (true)` without an adjacent assert

Subjective rules (naming, prose, simplicity) are not
audited -- read the reference doc for those.

## Reference

- [CLAUDE.md Fragment](docs/claude-md-fragment.md) --
  what `/tiger-style:tiger-init` appends to your project's CLAUDE.md
- [Full Reference](docs/TIGER_STYLE_REFERENCE.md) --
  long-form with rationale and examples
- [Upstream TIGER_STYLE.md][up] -- TigerBeetle's
  original (Apache-2.0)

## License

This plugin: public domain.

Tiger Style itself: Apache-2.0, (c) TigerBeetle.
Quotations and paraphrases in `docs/` and
`claude-md-fragment.md` are reproduced under fair use
and credited.
