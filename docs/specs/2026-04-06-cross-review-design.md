# Cross-Review Plugin Design

Superseded. Current behavior is native reviewers
(Claude `/code-review`, Codex `review/start`, Grok
`/review`) via a warm process pool. See
`plugins/cross-review/skills/cross-review/SKILL.md`.

---

# Cross-Review Plugin Design (2026-04-06)

## Problem

A single model's code review misses findings that a
different model catches. Our experiments on heddle's
server.zig showed Claude found 8 issues and Codex
found 5, with only 1 overlap. Cross-validation then
caught 4 false positives in Claude's findings. The
union of validated findings from both models provides
better coverage and higher precision than either alone.

## What It Does

`cross-review` is a Claude Code plugin that
orchestrates two independent code reviews (Claude and
GPT-5.4 via codex), cross-validates their findings
against each other, and outputs a merged fix list with
disputed findings separated for human review.

**Trigger:** `/cross-review [scope]` or dispatched as
an agent from another skill (e.g., TDD pipeline).

## Plugin Structure

```
plugins/cross-review/
  .claude-plugin/plugin.json
  skills/
    cross-review/SKILL.md     # orchestrator
    reviewer/SKILL.md         # Claude review role
    validator/SKILL.md        # cross-validation role
  docs/
    claude-md-fragment.md     # CLAUDE.md integration
```

- `plugin.json`: version 0.1.0, `strict: false`
  (needs Bash for codex script).
- `cross-review`: user-invocable orchestrator. Pure
  dispatcher — never edits code.
- `reviewer`: agent role prompt for Claude's initial
  review. Not user-invocable.
- `validator`: agent role prompt for cross-validation.
  Not user-invocable.

## Pipeline

### Step 1: Determine Scope and Package Context

Parse user arguments to build the review target.

- **Default:** all uncommitted changes (staged +
  unstaged), equivalent to `git diff HEAD`.
- **Freeform:** "last 2 commits", "src/server.zig",
  or any scope description. The orchestrator
  translates to the appropriate git diff or file list.
- Read `codex-script` path from project CLAUDE.md.

**Context packaging:** The orchestrator reads the
relevant files and diffs once, then inlines the
code slices directly in the prompts sent to both
reviewers. This is a default, not a hard rule —
agents can still read additional files if the
provided context is insufficient. The goal is to
avoid redundant file reads, not to restrict the
reviewer's ability to investigate.

### Step 2: Claude Review

Dispatch a **reviewer** agent (`subagent_type:
reviewer`) with the packaged context and the
reviewer role prompt. The agent returns findings
in the shared finding schema (see below).

### Step 3: Codex Review

Shell out to the codex companion script:

```bash
node <codex-script-path> task --wait "<prompt>"
```

The prompt includes the same packaged context and
asks for findings in the same schema. Uses `task`
(not `adversarial-review`) because `task` can review
arbitrary code, while `adversarial-review` only
reviews working-tree diffs.

### Step 4: Cross-Validation

Skip if `--quick` flag is set.

**Normalize before cross-injection.** The orchestrator
parses both models' findings into finding-schema
objects before handing them to the other model. Raw
prose output from one model is never injected into
the other's prompt. Each validator sees only the
structured finding list and the referenced code.

Run in parallel:
- Dispatch a **validator** agent with Codex's
  normalized findings and the code. Claude checks
  each finding: CONFIRMED, DISPUTED (with
  explanation), or UNCERTAIN.
- Shell out to codex `task --wait` with Claude's
  normalized findings and the code. Codex checks
  each finding with the same verdicts.

### Step 4b: Reconciliation (optional)

Skip unless `--reconcile` flag is set. Requires
Step 4 (cross-validation) to have run — incompatible
with `--quick`.

For each DISPUTED finding, send the original finding
plus the validator's dispute NOTES back to the model
that produced the finding. Ask: "The validator
disputed your finding with this reasoning. Do you
concede or maintain your position? If you maintain,
provide additional evidence from the code."

- If the originating model concedes, drop the finding
  from the disputed list entirely.
- If the originating model maintains with new
  evidence, keep it in the disputed list with both
  the original dispute and the rebuttal.

Run reconciliations in parallel (one per disputed
finding per model). Max one round — no back-and-forth
debate. The goal is to resolve clear factual errors,
not to argue indefinitely.

### Step 5: Merge and Output

**Fix list** (for implementing models and humans):
- All findings confirmed by both models in their
  initial reviews.
- Findings unique to one model but CONFIRMED during
  cross-validation.
- Flat prioritized list. Each entry uses the finding
  schema. No debate history.

**Disputed findings** (for humans only):
- Findings that received a DISPUTED verdict during
  cross-validation.
- Labeled: "Unverified — human review needed."
- Includes both the finding and the validator's
  dispute reasoning.

**`--quick` mode:**
- Union of all findings from both models.
- No validation status. No disputed section.

## Finding Schema

Both models output findings in this structure.
The orchestrator uses it for dedup, cross-validation,
and merge.

```
FINDING: <sequential id>
FILE: <path>
LINES: <start>-<end>
SEVERITY: <high|medium|low>
CATEGORY: <trust-boundary|resource-leak|race-condition|
           input-validation|error-handling|state-corruption|
           other>
ISSUE: <one-line summary>
DETAIL: <explanation — natural language, as long as
         needed to make the case>
RECOMMENDATION: <concrete fix>
```

During cross-validation, the validator appends:

```
STATUS: <CONFIRMED|DISPUTED|UNCERTAIN>
NOTES: <reasoning — required if DISPUTED>
```

This is not a wire protocol. It is a shared template
that makes parsing mechanical while keeping the
substance in natural language. The DETAIL and NOTES
fields carry the reasoning that makes cross-validation
work — they must not be compressed or eliminated.

## Role Prompts

### reviewer

Skeptical review stance. Focus on material findings
that are expensive, dangerous, or hard to detect:

- Trust boundaries and auth gaps
- Resource leaks and cleanup failures
- Race conditions and state corruption
- Buffer handling and input validation
- Error handling gaps and silent failures

Output uses the finding schema. Each finding must
fill every field. No style feedback, no naming
feedback, no speculative concerns without evidence.

~50 lines.

### validator

Takes a normalized list of findings (in finding
schema format) from the other model and the
referenced code. For each finding:

1. Read the actual code at the referenced lines.
2. Verify the claim matches what the code does.
3. Append STATUS and NOTES fields.
4. If DISPUTED, explain what the finding got wrong.

Key instruction: "Do not confirm out of politeness.
If the finding misreads the code, say so."

~40 lines.

## Codex Plugin Dependency

The codex companion script path is configured in the
project's CLAUDE.md via the `claude-md-fragment.md`:

```markdown
## Cross-Review Configuration
codex-script: ~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs
```

### Graceful Degradation

If the codex script path is missing or the script
fails:

- Fall back to Claude-only review. Single reviewer
  pass, no cross-validation.
- Warn the user that codex is unavailable and findings
  won't be cross-validated.
- No error, no abort.

## Composability

Designed to be dispatched as an agent from other
skills. Requirements:

- Output is parseable by another model (flat fix list).
- Works when dispatched as an agent, not only as a
  slash command.
- No interactive prompts or user questions mid-flow.

The TDD pipeline could add cross-review as a stage
after Code Reviewer (Stage 6). That's a future
tdd-pipeline change, not part of this plugin.

## Design Constraints

- **Pure skill orchestration.** No MCP server, no
  hooks, no scripts. All orchestration lives in
  SKILL.md files.
- **Orchestrator never edits code.** Same discipline
  as tdd-orchestrate — dispatch agents, merge results,
  format output.
- **No code-level coupling.** Follows the existing
  composition model. Communicates with the codex
  plugin only through the companion script CLI.
- **CLAUDE.md is the integration point.** The codex
  script path and any per-project configuration live
  in CLAUDE.md, not hardcoded.

## Experimental Evidence

Tested on heddle's server.zig (1237-line Zig terminal
multiplexer server):

| Metric | Result |
|---|---|
| Claude unique findings | 7 |
| Codex unique findings | 4 |
| Shared findings | 1 |
| Claude false positives caught by cross-validation | 4 of 8 (50%) |
| Codex false positives caught by cross-validation | 0 of 5 (0%) |
| Total validated findings (union) | 8 |

Cross-validation caught genuine analytical errors:
reversed code order, misidentified race conditions,
overstated vulnerability claims. The models had
complementary perspectives — Claude found internal
correctness issues, Codex found trust-boundary and
input-validation issues.

## Open Questions

None. All design decisions resolved during
brainstorming.
