# zig-claude-kit

Claude generates broken Zig code. This plugin fixes it by
injecting correct patterns into your project's CLAUDE.md.
Supports both **Zig 0.15.x** and **Zig 0.16.x** — the plugin
detects which version the project targets and uses the
matching reference.

## The Problem

Claude's Zig training predates 0.15. 0.16 (released April 2026)
piled on Writergate-scale changes again: every blocking API
takes a new `Io` parameter, `std.fs` moved to `std.Io`,
process state is no longer global, `std.mem.indexOf*` was
renamed to `find*`, `@Type` split into 8 concrete builtins,
and more. Without corrections, models generate code that
fails to compile against either version.

## What It Corrects

Patterns covered for **both 0.15.x and 0.16.x**:

1. **Writergate** — `getStdOut()`/`getStdErr()` removed,
   buffered writer pattern required
2. **build.zig** — `.root_source_file` moved inside
   `.root_module = b.createModule(...)`
3. **Format specifiers** — generic `{}` removed; use `{s}`,
   `{d}`, `{any}`, or `{f}` for format methods
4. **usingnamespace** / **async** / **await** — removed from
   the language
5. **BoundedArray** — removed; use
   `ArrayListUnmanaged.initBuffer`
6. **ArrayList** — managed API removed; use
   `ArrayListUnmanaged{}` with allocator per call
7. **Signed division** — `/` on runtime signed integers
   requires `@divTrunc`
8. **tokenize** — split into `tokenizeAny`, `tokenizeScalar`,
   `tokenizeSequence`
9. **For-loop index** — explicit range required:
   `for (items, 0..) |item, i|`
10. **JSON parser** — redesigned to `std.json.parseFromSlice`

Additional patterns covered for **0.16.x**:

11. **I/O is an Interface** — every blocking API takes
    `io: Io`; "Juicy Main" with `std.process.Init`
12. **`std.fs` → `std.Io`** namespace move (Dir, File, cwd,
    path)
13. **`std.mem.indexOf*` → `find*`** rename (full family)
14. **Process state no longer global** —
    `std.process.Init`/`Init.Minimal` for args + env
15. **`std.process.Child.init/spawn`** → `std.process.spawn`
16. **`std.process.getCwd*`** → `std.process.currentPath*`
17. **Sync primitives moved** — `std.Thread.{Mutex,...}` →
    `std.Io.{Mutex,...}`; `Thread.Pool` removed
18. **`std.heap.ThreadSafeAllocator`** removed; ArenaAllocator
    is now lock-free thread-safe
19. **Container changes** — managed `ArrayHashMap` family
    removed; `SegmentedList` deleted; `PriorityQueue` reworked
20. **`@Type` split** into 8 concrete builtins (`@Int`,
    `@Struct`, `@Union`, `@Enum`, `@EnumLiteral`, `@Tuple`,
    `@Pointer`, `@Fn`)
21. **`@cImport`** deprecated → `b.addTranslateC`
22. **`File.Stat.atime`** is now optional
23. **`std.io.fixedBufferStream`** removed → `Reader.fixed`
    / `Writer.fixed`
24. **Error renames** — `RenameAcrossMountPoints` →
    `CrossDevice`, `SharingViolation` → `FileBusy`, etc.
25. **Removed I/O types** — `GenericReader`/`AnyReader`/
    `GenericWriter`/`AnyWriter`/`null_writer`/
    `CountingReader`

## Install

```bash
/plugin marketplace add kelp/agent-plugins
/plugin install zig-claude-kit@agent-plugins
```

## Use

Open a Zig project. The plugin walks up from your working
directory to find `build.zig` or `build.zig.zon`, injects
the version-appropriate corrections for that session, and
suggests running `/zig-claude-kit:zig-init` to persist them.
That command appends corrections to your CLAUDE.md. Every
agent reads them as project context.

**Commands:**
- `/zig-claude-kit:zig-init` -- inject corrections into
  CLAUDE.md (auto-detects 0.15.x vs 0.16.x)
- `/zig-claude-kit:zig-patterns` -- quick reference,
  version-aware
- `/zig-claude-kit:zig-check` -- audit source files for
  outdated APIs, version-aware rule set

## Version detection

The plugin detects the target Zig version by:

1. Reading `.minimum_zig_version` from `build.zig.zon`
2. Falling back to `zig version` if zig is on PATH
3. Defaulting to `0.16` if neither signal is available

You can run the detector yourself to see what it reports:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/detect-zig-version.sh
```

## Verify

Run the blind-test suite to confirm corrections remain
necessary:

```bash
make eval-015                          # 14 probes vs Zig 0.15.x
make eval-016                          # 18 probes vs Zig 0.16.x
make eval-model MODEL=claude-haiku-4-5 # test one model (0.15.x)
make audit-015                         # validate 0.15 breaking-change claims
make audit-016                         # validate 0.16 breaking-change claims
make compile-test MODEL=claude-sonnet-4-6 VERSION=0.16
```

The eval suite supports both 0.15.x and 0.16.x:
- `eval-015` runs the original 14 probes against the `zig`
  on PATH. This is what generated the results table below.
- `eval-016` adds 4 more probes covering the 0.16-specific
  changes (file I/O with `io` param, `indexOf` → `find`,
  `Child.init` → `process.spawn`, `Thread.Mutex` →
  `Io.Mutex`) and compiles against Zig 0.16.0 (auto-located
  via `mise where zig@0.16.0`, or pass `ZIG=/path/to/zig`).

**Prerequisites:** `ANTHROPIC_API_KEY`, `uv`, and a Zig
toolchain. For `eval-016`, `mise install zig@0.16.0` is the
easiest way to get one without disturbing your default `zig`.

## Latest Eval Results (2026-02-27, Zig 0.15.2)

Tested with no project context.

| Probe | Sonnet 4.6 | Opus 4.6 |
|-------|------------|----------|
| 01 stdout (Writergate) | FAIL | FAIL |
| 02 stderr (Writergate) | FAIL | FAIL* |
| 03 ArrayList | FAIL | FAIL |
| 04 BoundedArray | FAIL | FAIL |
| 05 tokenize | pass | FAIL |
| 06 testing | pass | pass |
| 07 process args | FAIL | FAIL |
| 08 JSON | pass | FAIL |
| 09 format method | FAIL | FAIL |
| 10 mixin (usingnamespace) | FAIL | FAIL |
| 11 division | pass | pass |
| 12 for loop with index | pass | pass |
| 13 build.zig | FAIL* | FAIL* |
| 14 async/await | FAIL | FAIL |

\* Compiled only due to lazy analysis. Manual inspection
confirmed wrong patterns.

When all probes pass without corrections — across both 0.15
and 0.16 — retire this plugin.

## Reference

- [0.15.x Breaking Changes](docs/0.15/ZIG_BREAKING_CHANGES.md)
  -- full reference with error diagnostics
- [0.16.x Breaking Changes](docs/0.16/ZIG_BREAKING_CHANGES.md)
  -- full reference, Io interface, std.fs -> std.Io, etc.
- [0.15.x CLAUDE.md Fragment](docs/0.15/claude-md-fragment.md)
  -- corrections appended by `/zig-claude-kit:zig-init` for
  0.15.x projects
- [0.16.x CLAUDE.md Fragment](docs/0.16/claude-md-fragment.md)
  -- corrections appended by `/zig-claude-kit:zig-init` for
  0.16.x projects

## License

Public domain.
