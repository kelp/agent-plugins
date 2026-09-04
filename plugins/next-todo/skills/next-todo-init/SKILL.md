---
name: next-todo-init
description: >
  Add Next TODO binding to this project's CLAUDE.md.
  Run this to set up the next-todo plugin for a new
  project.
user-invocable: true
---

# /next-todo-init

Add Next TODO binding to this project's CLAUDE.md.

## Procedure

### 1. Read the configuration fragment

Read the file at
`${CLAUDE_PLUGIN_ROOT}/docs/claude-md-fragment.md`.
This contains the Next TODO binding template formatted
as a CLAUDE.md section.

### 2. Check current CLAUDE.md

- If no `CLAUDE.md` exists in the project root, create
  one with just a `# CLAUDE.md` header followed by the
  fragment content.
- If `CLAUDE.md` exists, check if it already contains
  "Next TODO binding". If so, report "Next TODO binding
  already present" and stop.
- If `CLAUDE.md` exists but lacks the binding, append
  the fragment content to the end of the file.

### 3. Report result

Tell the user what you did:
- "Created CLAUDE.md with Next TODO binding"
- "Added Next TODO binding to existing CLAUDE.md"
- "Next TODO binding already present in CLAUDE.md"

### 4. Next steps

Tell the user to fill in the seven binding values:
backlog, plan, spec, gates, CI, review axes, and rules.
The backlog is a GitHub repository. Tell the user to
create the labels `parent`, `ready`, `in-progress`, and
`blocked` in that repository when they do not exist.
