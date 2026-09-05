# Cross-Review Plugin Implementation Plan

Superseded. Current plugin: native Claude / Codex /
Grok reviewers and a warm pool, not companion `task`
plus a custom finding schema. See
`plugins/cross-review/skills/cross-review/SKILL.md`.

---

# Cross-Review Plugin Implementation Plan (2026-04-06)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Build a Claude Code plugin that orchestrates
two independent code reviews (Claude + GPT-5.4) with
cross-validation, outputting a merged fix list.

**Architecture:** Pure skill orchestration — three
SKILL.md files (orchestrator, reviewer role, validator
role) plus a plugin manifest and CLAUDE.md fragment.
No MCP server, no hooks, no scripts. Follows the same
patterns as the tdd-pipeline plugin in this repo.

**Tech Stack:** Claude Code plugin system (SKILL.md
files, plugin.json, CLAUDE.md fragments).

---

## File Structure

```
plugins/cross-review/
  .claude-plugin/plugin.json     # plugin manifest
  skills/
    cross-review/SKILL.md        # orchestrator skill
    reviewer/SKILL.md            # Claude review role
    validator/SKILL.md           # cross-validation role
  docs/
    claude-md-fragment.md        # CLAUDE.md template
```

Also modified:
- `.claude-plugin/marketplace.json` — register the
  new plugin

---

### Task 1: Plugin Manifest and Marketplace Registration

**Files:**
- Create: `plugins/cross-review/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Create plugin.json**

```json
{
  "name": "cross-review",
  "description": "Multi-model code review with cross-validation. Orchestrates Claude and GPT-5.4 reviews, validates findings against each other, outputs merged fix list.",
  "version": "0.1.0",
  "author": {
    "name": "Travis Cole"
  },
  "homepage": "https://github.com/kelp/kelp-claude-plugins",
  "repository": "https://github.com/kelp/kelp-claude-plugins"
}
```

- [ ] **Step 2: Register in marketplace.json**

Add to the `plugins` array in
`.claude-plugin/marketplace.json`:

```json
{
  "name": "cross-review",
  "source": "./plugins/cross-review",
  "description": "Multi-model code review with cross-validation. Orchestrates Claude and GPT-5.4 reviews, validates findings against each other, outputs merged fix list.",
  "strict": false
}
```

`strict: false` because the orchestrator needs Bash
access to call the codex companion script.

- [ ] **Step 3: Commit**

```bash
git add plugins/cross-review/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "Add cross-review plugin manifest"
```

---

### Task 2: Reviewer Role Prompt

The reviewer skill defines how Claude performs its
initial code review. Not user-invocable — injected
into an agent prompt by the orchestrator.

**Reference files to read first:**
- `plugins/tdd-pipeline/skills/code-reviewer/SKILL.md`
  for the existing role prompt format
- `docs/specs/2026-04-06-cross-review-design.md` for
  the finding schema and review focus areas

**Files:**
- Create: `plugins/cross-review/skills/reviewer/SKILL.md`

- [ ] **Step 1: Write the reviewer skill**

```markdown
---
name: reviewer
description: >
  Claude review role for cross-review plugin.
  Performs adversarial code review focused on
  material findings. Not user-invocable — dispatched
  by the cross-review orchestrator.
user-invocable: false
---

# Reviewer

Perform an adversarial code review. Your job is to
find material issues — things that are expensive,
dangerous, or hard to detect. Do NOT report style,
naming, or speculative concerns.

## Rules

- Do NOT modify any files
- Do NOT write code fixes
- Report findings in the schema below — nothing else

## Review Focus

Prioritize failures that are expensive, dangerous,
or hard to detect:

- Trust boundaries: auth, permissions, tenant
  isolation, input from untrusted sources
- Resource management: leaks, cleanup failures,
  missing errdefer/finally/close
- Concurrency: race conditions, ordering assumptions,
  stale state, re-entrancy
- Input handling: unbounded values, missing
  validation, injection, path traversal
- Error handling: swallowed errors, silent failures,
  partial failure states
- State corruption: invariant violations, unreachable
  states, irreversible damage

## Evidence Standard

Every finding must be defensible from the code you
can see. Do not invent files, lines, code paths, or
failure scenarios you cannot support. If a conclusion
depends on an inference, state that in the DETAIL
field and set SEVERITY accordingly.

Prefer one strong finding over several weak ones.
If the code looks correct, say so and return no
findings.

## Output Format

Return findings in this exact schema. Each finding
must fill every field.

    FINDING: <sequential id starting at 1>
    FILE: <path relative to repo root>
    LINES: <start>-<end>
    SEVERITY: <high|medium|low>
    CATEGORY: <trust-boundary|resource-leak|
               race-condition|input-validation|
               error-handling|state-corruption|other>
    ISSUE: <one-line summary>
    DETAIL: <explanation — as long as needed>
    RECOMMENDATION: <concrete fix>

If there are no material findings, return:

    NO_FINDINGS: Code review found no material issues.
```

- [ ] **Step 2: Verify frontmatter format**

Check that the YAML frontmatter matches the pattern
used in `plugins/tdd-pipeline/skills/code-reviewer/SKILL.md`:
`name`, `description`, `user-invocable: false`.

- [ ] **Step 3: Commit**

```bash
git add plugins/cross-review/skills/reviewer/SKILL.md
git commit -m "Add reviewer role prompt for cross-review"
```

---

### Task 3: Validator Role Prompt

The validator skill defines how each model checks
the other's findings during cross-validation.

**Reference files to read first:**
- `plugins/cross-review/skills/reviewer/SKILL.md`
  for the finding schema (validator must match it)
- `docs/specs/2026-04-06-cross-review-design.md` for
  validator behavior spec

**Files:**
- Create: `plugins/cross-review/skills/validator/SKILL.md`

- [ ] **Step 1: Write the validator skill**

```markdown
---
name: validator
description: >
  Cross-validation role for cross-review plugin.
  Checks findings from another model against the
  actual code. Not user-invocable — dispatched by
  the cross-review orchestrator.
user-invocable: false
---

# Validator

You are validating code review findings produced by
another model. For each finding, determine whether
it is correct by reading the actual code.

## Rules

- Do NOT modify any files
- Do NOT write code fixes
- Do NOT confirm findings out of politeness
- If a finding misreads the code, say so directly
- If you cannot verify a finding from the code you
  can see, mark it UNCERTAIN — do not guess

## Process

For each finding in the list below:

1. Read the actual code at the FILE and LINES
   referenced in the finding.
2. Verify that the claim in ISSUE and DETAIL matches
   what the code does.
3. Check the code surrounding the referenced lines
   for context that might confirm or refute the claim.
4. If the finding references specific behavior (e.g.,
   "this loop iterates backwards"), verify that the
   code does what the finding says it does.
5. Append your STATUS and NOTES.

## Output Format

Return each finding with STATUS and NOTES appended.
Keep the original finding fields unchanged.

    FINDING: <original id>
    FILE: <original>
    LINES: <original>
    SEVERITY: <original>
    CATEGORY: <original>
    ISSUE: <original>
    DETAIL: <original>
    RECOMMENDATION: <original>
    STATUS: <CONFIRMED|DISPUTED|UNCERTAIN>
    NOTES: <your reasoning — required if DISPUTED,
            recommended for all>

Status meanings:
- CONFIRMED: You verified the issue exists in the
  code at the referenced location.
- DISPUTED: The finding is wrong or materially
  overstated. NOTES must explain what the finding
  got wrong.
- UNCERTAIN: Plausible but you cannot verify from
  the code available. NOTES should say what
  additional context would resolve it.
```

- [ ] **Step 2: Verify schema alignment**

Confirm that the finding fields in the validator's
output format match the reviewer's output format
exactly (FINDING, FILE, LINES, SEVERITY, CATEGORY,
ISSUE, DETAIL, RECOMMENDATION) plus the two appended
fields (STATUS, NOTES).

- [ ] **Step 3: Commit**

```bash
git add plugins/cross-review/skills/validator/SKILL.md
git commit -m "Add validator role prompt for cross-review"
```

---

### Task 4: CLAUDE.md Fragment

The fragment tells users how to configure their
project for cross-review.

**Reference files to read first:**
- `plugins/tdd-pipeline/docs/claude-md-fragment.md`
  for the existing fragment format

**Files:**
- Create: `plugins/cross-review/docs/claude-md-fragment.md`

- [ ] **Step 1: Write the CLAUDE.md fragment**

```markdown
## Cross-Review Configuration

### Codex Script
codex-script: ~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs

### Review Focus (optional)
Customize what cross-review prioritizes for this
project. Delete or leave blank to use defaults.

review-focus: <optional: e.g., "auth boundaries,
  database migrations, API compatibility">
```

- [ ] **Step 2: Commit**

```bash
git add plugins/cross-review/docs/claude-md-fragment.md
git commit -m "Add CLAUDE.md fragment for cross-review"
```

---

### Task 5: Orchestrator Skill

This is the core of the plugin. The orchestrator is
user-invocable (`/cross-review`), parses arguments,
packages context, dispatches reviewers, runs
cross-validation, and merges output.

**Reference files to read first:**
- `plugins/tdd-pipeline/skills/tdd-orchestrate/SKILL.md`
  for the orchestration pattern (pure dispatcher,
  reads skill files verbatim, dispatches agents)
- `plugins/cross-review/skills/reviewer/SKILL.md`
  (created in Task 2)
- `plugins/cross-review/skills/validator/SKILL.md`
  (created in Task 3)
- `docs/specs/2026-04-06-cross-review-design.md`
  for the full pipeline spec

**Files:**
- Create: `plugins/cross-review/skills/cross-review/SKILL.md`

- [ ] **Step 1: Write the orchestrator skill**

```markdown
---
name: cross-review
description: >
  Multi-model code review with cross-validation.
  Orchestrates independent Claude and GPT-5.4 reviews,
  cross-validates findings, outputs merged fix list.
  Use when reviewing code changes, auditing files, or
  wanting a second opinion. Triggers on: "cross-review",
  "multi-model review", "review with codex", "get a
  second opinion on this code".
user-invocable: true
---

# /cross-review

Multi-model code review with cross-validation.

## Input

Scope: $ARGUMENTS

If no scope was provided, default to all uncommitted
changes (staged + unstaged).

Flags:
- `--quick`: skip cross-validation, merge findings
  from both models without checking each other's work

## The Rule

You are a PURE DISPATCHER. You never edit source
files. You dispatch agents, run commands, parse
results, and format output. Nothing else.

Violations — if you catch yourself thinking any of
these, STOP:
- "Let me fix this finding real quick"
- "I'll review the code myself instead of dispatching"
- "The codex output needs cleanup, let me rewrite it"
- "I can skip the validator for this obvious finding"

## Pipeline

### Step 1: Determine Scope and Package Context

1. Parse the user's scope argument:
   - No argument: `git diff HEAD` for all uncommitted
     changes. Also run `git diff --cached` and
     `git diff` to capture both staged and unstaged.
   - "last N commits": `git diff HEAD~N..HEAD`
   - File paths: read those files directly
   - Other freeform: translate to the appropriate
     git command
2. Read the project's CLAUDE.md for cross-review
   configuration:
   - `codex-script`: path to the codex companion
     script. If missing, set `codex_available = false`.
   - `review-focus`: optional project-specific review
     priorities.
3. Package the context: read the relevant files/diffs
   and hold them in memory. You will inline this
   context in the prompts for both reviewers.

### Step 2: Claude Review

Read the reviewer skill file:
`${CLAUDE_PLUGIN_ROOT}/skills/reviewer/SKILL.md`

Dispatch a **reviewer** agent with:
- `subagent_type: reviewer`
- The reviewer skill content (verbatim)
- The packaged context (diffs and/or file contents)
- Project-specific review-focus from CLAUDE.md
  (if configured)

The agent returns findings in the finding schema.

### Step 3: Codex Review

Skip if `codex_available` is false. Warn the user:
"Codex unavailable — running Claude-only review.
Findings will not be cross-validated."

Shell out to the codex companion script:

```bash
node <codex-script> task --wait "<prompt>"
```

The prompt must include:
- The same packaged context given to Claude
- Instructions to return findings in the finding
  schema (copy the Output Format section from the
  reviewer skill into the prompt)
- Project-specific review-focus (if configured)

Parse Codex's output and extract findings in the
schema format.

### Step 4: Cross-Validation

Skip if `--quick` flag is set. Skip if codex was
unavailable (nothing to cross-validate).

**Normalize findings.** Before cross-injection:
- Parse Claude's findings into individual schema
  objects
- Parse Codex's findings into individual schema
  objects
- Do NOT inject raw prose from one model into the
  other's prompt

Read the validator skill file:
`${CLAUDE_PLUGIN_ROOT}/skills/validator/SKILL.md`

Run in parallel:

**Claude validates Codex's findings:**
Dispatch a **validator** agent with:
- `subagent_type: reviewer`
- The validator skill content (verbatim)
- Codex's normalized findings
- The packaged context (so the validator can read
  the referenced code)

**Codex validates Claude's findings:**
Shell out to codex `task --wait` with:
- The validator skill content (in the prompt)
- Claude's normalized findings
- The packaged context

Both return findings with STATUS and NOTES appended.

### Step 5: Merge and Output

**Identify shared findings:** Compare findings from
both models by FILE, LINES, and ISSUE. Findings that
reference the same code location and describe the
same issue are shared. Shared findings are
automatically confirmed — both models found them
independently.

**Build the fix list:** Include:
1. All shared findings (confirmed by both models)
2. Unique findings with STATUS: CONFIRMED
3. Unique findings with STATUS: UNCERTAIN

Order by: SEVERITY (high first), then by file path.

**Build the disputed list:** Include:
- Unique findings with STATUS: DISPUTED
- Include the validator's NOTES explaining the
  dispute

**Format the output:**

```
## Cross-Review Results

Reviewed: <scope description>
Models: Claude + GPT-5.4
Mode: <full | quick | claude-only>

### Fix List

<numbered list of confirmed findings in schema
format, without STATUS/NOTES fields>

### Disputed Findings (human review needed)

These findings were disputed during cross-validation.
Review the validator's reasoning and decide whether
to act on them.

<numbered list of disputed findings with STATUS
and NOTES fields included>
```

**`--quick` mode output:**

```
## Cross-Review Results (Quick)

Reviewed: <scope description>
Models: Claude + GPT-5.4
Mode: quick (no cross-validation)

### Findings

<numbered list of all findings from both models,
deduplicated by FILE+LINES+ISSUE>
```

**Claude-only mode output:**

```
## Cross-Review Results (Claude Only)

Reviewed: <scope description>
Models: Claude only (codex unavailable)
Mode: claude-only

Note: Codex was unavailable. Findings are from a
single model and have not been cross-validated.

### Findings

<numbered list of Claude's findings>
```

## Codex Prompt Template

When calling the codex companion script, use this
prompt structure:

```
Perform an adversarial code review of the following
code. Focus on material findings that are expensive,
dangerous, or hard to detect. Do not report style,
naming, or speculative concerns.

<if review-focus is configured>
Project-specific focus: <review-focus value>
</if>

Return findings in this exact format:

FINDING: <sequential id>
FILE: <path>
LINES: <start>-<end>
SEVERITY: <high|medium|low>
CATEGORY: <trust-boundary|resource-leak|
           race-condition|input-validation|
           error-handling|state-corruption|other>
ISSUE: <one-line summary>
DETAIL: <explanation>
RECOMMENDATION: <concrete fix>

If there are no material findings, return:
NO_FINDINGS: Code review found no material issues.

Code to review:

<packaged context here>
```

## Codex Validation Prompt Template

When calling codex for cross-validation, use this
prompt structure:

```
You are validating code review findings produced by
another model. For each finding, determine whether
it is correct by reading the actual code.

Do NOT confirm findings out of politeness. If a
finding misreads the code, say so directly.

For each finding:
1. Read the code at the referenced FILE and LINES
2. Verify the claim matches the code
3. Append STATUS and NOTES

Return each finding with STATUS and NOTES appended:

STATUS: <CONFIRMED|DISPUTED|UNCERTAIN>
NOTES: <reasoning — required if DISPUTED>

Findings to validate:

<normalized findings here>

Code for reference:

<packaged context here>
```
```

- [ ] **Step 2: Verify skill file completeness**

Check that the orchestrator:
- References `${CLAUDE_PLUGIN_ROOT}` for skill paths
  (not hardcoded paths)
- Includes the finding schema in codex prompts (codex
  doesn't have access to the reviewer skill file)
- Handles all three modes: full, quick, claude-only
- Never edits code (pure dispatcher)
- Includes both codex prompt templates (review and
  validation)

- [ ] **Step 3: Commit**

```bash
git add plugins/cross-review/skills/cross-review/SKILL.md
git commit -m "Add cross-review orchestrator skill"
```

---

### Task 6: Update Repo CLAUDE.md

Add cross-review to the repository's CLAUDE.md
description of what plugins exist.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read current CLAUDE.md**

Read `CLAUDE.md` to find where the plugin list is.

- [ ] **Step 2: Add cross-review to plugin list**

In the "What This Repo Is" section, add cross-review
to the plugin list. It currently says two plugins;
update to three:

```markdown
A Claude Code plugin marketplace containing three
plugins:

- **zig-claude-kit** -- corrective context for Zig
  0.15.x that fixes Claude's outdated training data
- **tdd-pipeline** -- language-agnostic TDD pipeline
  with seven agents across separate stages
- **cross-review** -- multi-model code review with
  cross-validation using Claude and GPT-5.4
```

Also add to the Repository Structure section:

```
  cross-review/
    .claude-plugin/plugin.json     # manifest
    skills/                        # cross-review, reviewer, validator
    docs/                          # claude-md-fragment
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Add cross-review to repo documentation"
```

---

### Task 7: Smoke Test

Run `/cross-review` against real code to verify the
full pipeline works end-to-end.

- [ ] **Step 1: Install the plugin locally**

From the repo root, verify the plugin is visible:

```bash
cat .claude-plugin/marketplace.json | grep cross-review
```

- [ ] **Step 2: Run a quick-mode test**

In the heddle repo (`/Users/tcole/code/heddle`), run:

```
/cross-review --quick src/server.zig
```

Verify:
- Claude review runs and returns findings in schema
- Codex review runs and returns findings in schema
- Output is formatted as "Cross-Review Results (Quick)"
- Findings are deduplicated

- [ ] **Step 3: Run a full-mode test**

In the heddle repo, run:

```
/cross-review src/server.zig
```

Verify:
- Both reviews run
- Cross-validation runs (both directions)
- Output has "Fix List" and "Disputed Findings"
  sections
- Disputed findings include validator NOTES

- [ ] **Step 4: Test graceful degradation**

Temporarily remove the `codex-script` line from
heddle's CLAUDE.md and run:

```
/cross-review src/server.zig
```

Verify:
- Warns about codex unavailability
- Falls back to Claude-only review
- Output is formatted as "Cross-Review Results
  (Claude Only)"

Restore the `codex-script` line after testing.

- [ ] **Step 5: Commit any fixes**

If smoke testing revealed issues in the skill files,
fix them and commit:

```bash
git add -A
git commit -m "Fix cross-review issues found in smoke test"
```
