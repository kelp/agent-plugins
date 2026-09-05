---
name: tdd-init
description: >
  Add the TDD pipeline configuration template to this
  project's instructions file (CLAUDE.md or AGENTS.md).
  Run this to set up the pipeline for a new project.
user-invocable: true
---

# /tdd-init

Add TDD pipeline configuration to this project's
instructions file.

## Procedure

### 1. Read the configuration fragment

Read `docs/claude-md-fragment.md` in the plugin
directory (`${CLAUDE_PLUGIN_ROOT}` on Claude Code;
otherwise the parent of the `skills/` directory that
holds this file). It contains the TDD pipeline
configuration template, formatted as one markdown
section that works in either instructions file.

### 2. Check the instructions file

- If `CLAUDE.md` or `AGENTS.md` in the project root
  already contains "TDD Pipeline Configuration", report
  "TDD pipeline configuration already present in
  <file>" and stop.
- Else if `CLAUDE.md` exists, append the fragment to
  the end of it.
- Else if `AGENTS.md` exists, append the fragment to
  the end of it.
- Else create `CLAUDE.md` with a `# CLAUDE.md` header
  followed by the fragment.

### 3. Report result

Tell the user what you did and which file you touched:
- "Created CLAUDE.md with TDD pipeline configuration"
- "Added TDD pipeline configuration to existing
  <file>"
- "TDD pipeline configuration already present in
  <file>"

### 4. Next steps

Tell the user to fill in the template values:
- Test command for individual modules
- Source and test file path patterns
- Build integration steps
- Full test and lint commands
- Any language-specific agent context
