---
name: tdd-init
description: "Add TDD pipeline configuration to a project's CLAUDE.md — inserts test command templates, source and test file path patterns, build integration steps, verify gate checks, and language-specific agent context. Use when setting up test-driven development, initializing a TDD workflow, configuring red-green-refactor for a new project, or preparing a codebase for the tdd-orchestrate pipeline."
user-invocable: true
---

# /tdd-init

Add TDD pipeline configuration to this project's CLAUDE.md so
`tdd-orchestrate` knows how to run tests, locate source files,
and validate implementations.

## Procedure

### 1. Read the configuration fragment

```bash
cat "${CLAUDE_PLUGIN_ROOT}/docs/claude-md-fragment.md"
```

This file contains a CLAUDE.md section with placeholder values for:
- **Test command** — how to run tests for a single module
- **Source layout** — source and test file path patterns
- **Build integration** — post-approval steps, full test suite, linter
- **Verify gate checks** — test pass, no stubs, lint clean
- **Language-specific context** — optional corrections or plugin references

### 2. Check current CLAUDE.md

```bash
if [[ -f CLAUDE.md ]]; then
  grep -q "TDD Pipeline Configuration" CLAUDE.md && echo "ALREADY_PRESENT"
fi
```

- **No CLAUDE.md exists**:
  ```bash
  echo "# CLAUDE.md" > CLAUDE.md
  cat "${CLAUDE_PLUGIN_ROOT}/docs/claude-md-fragment.md" >> CLAUDE.md
  ```
- **Already contains "TDD Pipeline Configuration"** — report
  "TDD pipeline configuration already present" and stop.
- **CLAUDE.md exists without configuration**:
  ```bash
  printf '\n' >> CLAUDE.md
  cat "${CLAUDE_PLUGIN_ROOT}/docs/claude-md-fragment.md" >> CLAUDE.md
  ```

### 3. Report result

Tell the user exactly what happened:
- "Created CLAUDE.md with TDD pipeline configuration"
- "Added TDD pipeline configuration to existing CLAUDE.md"
- "TDD pipeline configuration already present in CLAUDE.md"

### 4. Next steps

Tell the user to replace the template placeholders:
- `<TEST_COMMAND>` — e.g. `pytest tests/test_{module}.py`
- `<SOURCE_PATTERN>` — e.g. `src/{module}.py`
- `<TEST_PATTERN>` — e.g. `tests/test_{module}.py`
- `<FULL_TEST_COMMAND>` — e.g. `pytest`
- `<LINT_COMMAND>` — e.g. `ruff check .`
- Language-specific agent context (optional)
