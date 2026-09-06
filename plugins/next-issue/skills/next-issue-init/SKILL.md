---
name: next-issue-init
description: >
  Add Next issue binding to this project's CLAUDE.md.
  Run this to set up the next-issue plugin for a new
  project.
user-invocable: true
---

# /next-issue-init

Add Next issue binding to this project's CLAUDE.md.

## Procedure

### 1. Read the configuration fragment

Read the file at
`${CLAUDE_PLUGIN_ROOT}/docs/claude-md-fragment.md`.
This contains the Next issue binding template formatted
as a CLAUDE.md section.

### 2. Check current CLAUDE.md

- If no `CLAUDE.md` exists in the project root, create
  one with just a `# CLAUDE.md` header followed by the
  fragment content.
- If `CLAUDE.md` exists, check if it already contains
  "Next issue binding" or the old heading "Next TODO
  binding". If so, report that the binding is already
  present and stop. Do not add a second copy.
- If `CLAUDE.md` exists but lacks both headings, append
  the fragment content to the end of the file.

### 3. Report result

Tell the user what you did:
- "Created CLAUDE.md with Next issue binding"
- "Added Next issue binding to existing CLAUDE.md"
- "Issue binding already present in CLAUDE.md"

### 4. Next steps

Tell the user to fill in the eight binding values:
backlog, plan, spec, gates, CI, review axes, rules, and
claims (optional).
The backlog is a GitHub repository. Tell the user to
create the labels `parent`, `ready`, `in-progress`, and
`blocked` in that repository when they do not exist.

Previously this command was `/next-todo-init`.
