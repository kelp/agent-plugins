# Multi-Model Skills Roadmap

## Context

After researching agent harnesses (pi, Crush, opencode,
Codex), extension models, and multi-model orchestration
patterns, the conclusion is: Claude Code's existing
extension surface (skills, plugins, hooks, MCP, subagents)
covers most use cases. The real gap isn't infrastructure
— it's orchestration skills that coordinate multiple
models effectively.

Key findings that inform this roadmap:

- **Anthropic handles token efficiency.** Don't compete
  with them on cache-hit tuning or microcompaction.
- **OpenAI ships codex-plugin-cc** — a maintained plugin
  giving Claude Code full GPT-5.4 agents via ChatGPT
  subscription billing. No need to build our own bridge.
- **MCP tools participate in Claude's agent loop.** Claude
  can call a tool, read the result, disagree, call again.
  This enables debate/reconciliation without special infra.
- **Gemini is the one gap.** No subscription-backed SDK
  access — Google walls it off to Gemini CLI. API billing
  via `@google/genai` is the only clean path.
- **OAuth/subscription billing:** OpenAI subscriptions
  only work through Codex CLI (chatgpt.com/backend-api).
  Google subscriptions only work through Gemini CLI
  (cloudcode-pa.googleapis.com). Both SDKs are API-key
  / pay-per-token only.

Status as of 2026-09: `cross-review` ships native
reviews from Claude, Codex, and Grok. `pair` is a
persistent navigator on any of those three. Neither
uses the Codex companion `task` path. Items below are
the original roadmap.

## Plugins to Build

### 1. adversarial-review (skill + CLAUDE.md guidance)

Coordinate Claude and GPT-5.4 reviews on the same code,
then reconcile disagreements through debate.

**How it works:**
- Claude reviews code changes (built-in capability)
- Skill dispatches codex:codex-rescue for independent
  GPT-5.4 review of the same changes
- Claude compares both reviews, identifies disagreements
- For each disagreement, Claude argues its position and
  dispatches codex again with the counterargument
- Iterate until reconciled or max rounds reached
- Output: merged review with noted agreements and
  resolved disagreements

**Pattern:** No MCP server needed. Skill orchestrates
via codex subagent dispatch + Claude's own reasoning
loop. CLAUDE.md guidance tells Claude when/how to
invoke this workflow.

**Trigger:** `/adversarial-review` or "review this
with a second opinion"

**Priority:** High — directly useful, builds on existing
codex plugin, demonstrates the multi-model pattern.

### 2. cross-model-tdd (extend tdd-pipeline)

Add a cross-model validation step to the existing
tdd-pipeline. After the Code Reviewer (step 6), dispatch
GPT-5.4 to independently review the implementation
against the tests.

**Changes to tdd-pipeline:**
- New optional step between Code Reviewer and Integrate
- Dispatches codex to review implementation + tests
- If codex finds issues Claude's reviewer missed, loop
  back to Implementer
- Configurable: skip for small changes, always-on for
  new modules

**Priority:** Medium — extends existing plugin, but
tdd-pipeline already catches most issues. Cross-model
adds value for subtle logic bugs where a different
model's perspective helps.

### 3. self-rescue (CLAUDE.md pattern + optional skill)

When Claude has failed at the same implementation twice,
automatically offer to delegate to GPT-5.4.

**Implementation options:**
- **Minimal:** Add to project CLAUDE.md: "If you've
  failed at the same implementation twice, offer to
  delegate to codex for a fresh approach."
- **Skill:** `/rescue` that explicitly dispatches the
  current task to codex with full context of what
  Claude tried and why it failed.
- **Hook:** PostToolUse hook that detects repeated
  failures and injects a suggestion.

**Priority:** Medium — useful but the minimal CLAUDE.md
approach may be sufficient without a formal plugin.

### 4. gemini-agent (MCP server)

The one piece that needs actual code. An MCP server
that runs Gemini as a coding agent with tool access.

**Architecture:**
- MCP server (stdio transport) wrapping `@google/genai`
- Tools: read file, write file, bash, grep, glob
- Agent loop via manual tool-call cycle (google-genai
  has no built-in agent loop — write ~50 lines)
- Conversation state maintained per session for debate
- Auth: `GEMINI_API_KEY` env var (no subscription path)

**Tools exposed to Claude Code:**
- `gemini_review(files, instructions)` — code review
- `gemini_implement(instructions, context)` — write code
- `gemini_debate(session_id, argument)` — continue debate

**Size estimate:** ~300 lines total. The MCP server
wrapper is ~100 lines, the agent loop adapter is ~50,
the coding tools are ~100, session state is ~50.

**Priority:** Low-medium — useful for true three-model
validation, but two models (Claude + GPT-5.4) cover
most adversarial value. Build when the two-model
workflow is proven.

### 5. debate (generic skill)

A reusable debate/reconciliation skill that works with
any model combination available via tools or subagents.

**How it works:**
- Takes two or more positions (from different reviews,
  implementations, or analyses)
- Identifies specific disagreements
- For each disagreement, argues both sides with evidence
- Optionally dispatches to a third model as tiebreaker
- Produces a reconciled output with confidence levels

**Priority:** Low — the adversarial-review skill handles
the primary use case. Generalize only after patterns
emerge from real usage.

## Architecture Principles

1. **Skills over MCP servers.** If it can be done with
   a skill (prompt + orchestration), don't build an MCP
   server. MCP servers are for when you need code
   execution (calling external APIs, running agent loops).

2. **Codex plugin is the GPT-5.4 bridge.** Don't
   reimplement what OpenAI maintains. Dispatch to
   codex:codex-rescue and parse the result.

3. **Debate is a loop, not a dispatch.** Claude calls a
   tool, reads the critique, forms a counterargument,
   calls again. This is Claude's normal agent loop —
   don't over-engineer the orchestration.

4. **CLAUDE.md is the lightest extension.** Before
   building a skill, try adding guidance to CLAUDE.md.
   "If you disagree with a codex review, push back"
   might be all you need.

5. **Build for Claude Code first, portability second.**
   Skills and CLAUDE.md are Claude Code native. If
   something proves valuable, consider an MCP server
   version for portability to other harnesses.

## Build Order

```
Phase 1: adversarial-review skill
         (prove the multi-model pattern works)

Phase 2: cross-model-tdd extension
         self-rescue CLAUDE.md pattern
         (extend existing plugins)

Phase 3: gemini-agent MCP server
         debate skill
         (only if two-model isn't enough)
```

## Open Questions

- Does the codex plugin support passing structured
  context (file diffs, previous review) cleanly, or
  does everything go through the prompt string?
- What's the right max-rounds for debate before
  declaring "agree to disagree"? Probably 3.
- Should adversarial-review run automatically on PRs
  (via a hook) or only on demand?
- Is Gemini worth the API cost for a third opinion,
  or do Claude + GPT-5.4 provide enough diversity?
