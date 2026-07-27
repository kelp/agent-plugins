# Merge and Output Reference

Read by the orchestrator at Step 5 of the cross-review
pipeline. Defines deduplication, merge mechanics, fix-list
assembly, and the output template for all three modes.

## Deduplication

Two findings are duplicates only if they describe the SAME
UNDERLYING BUG. Shared location is necessary but NOT
sufficient — two distinct bugs can live at the same lines.
Apply a two-step test.

**Step A: Location filter (necessary condition).**
Candidates for dedup MUST share FILE and have overlapping
LINES ranges (share at least one line). Findings that
don't overlap are always distinct. Line overlap catches
the off-by-one case where models reference nearby line
numbers for the same bug.

**Step B: Semantic judgment (sufficient condition).**
Among location candidates, compare the ISSUE and DETAIL
fields. Two findings are the SAME underlying bug if they
explain the same failure mechanism or root cause — even
if they categorize or phrase it differently. Two findings
are DIFFERENT bugs if they explain distinct mechanisms,
distinct failure modes, or require distinct fixes — even
if they happen to point at the same line range.

Examples:

- **Same bug, different framing (MERGE):** Claude says
  "input-validation: unbounded loop counter leads to
  integer overflow" and Codex says "state-corruption:
  counter wraps past INT_MAX in the same loop." Both
  describe the counter overflow. Different CATEGORY, same
  mechanism — merge.

- **Same location, different bugs (DO NOT MERGE):**
  Claude says "size threshold ignores prompt overhead"
  and Codex says "size gate measures diff but packages
  files." Both point at the same line range. The first is
  about a wrong numeric threshold; the second is about
  what gets measured vs. packaged. Two distinct fixes —
  keep separate.

**Default on uncertainty: DO NOT merge.** If you cannot
confidently say two findings describe the same underlying
bug, keep them separate. The cost of a mildly inflated
fix list is small. The cost of merging distinct findings
is lost signal — one concern gets buried under the other.

**When merging confirmed duplicates:**
- Keep the finding with more DETAIL; fold in any unique
  information from the shorter one.
- If CATEGORY disagrees, record both in a `CATEGORIES`
  metadata field (e.g., `CATEGORIES: trust-boundary
  (codex), input-validation (claude)`) so the
  disagreement is visible.
- Mark the merged finding as `CONFIRMED_BY: both`.

**When keeping related-but-distinct findings:**
- List both in the fix list independently.
- Add a `RELATED_TO: <finding id>` field on each so the
  human reader understands the locations overlap but the
  findings are distinct concerns.
- This keeps the signal without losing the relationship.

## Fix list assembly

**Fix list entries** (full and quick modes):
- Findings confirmed by both models in their initial
  reviews (shared findings)
- Findings unique to one model and CONFIRMED during
  cross-validation
- Sorted by SEVERITY (high → medium → low)

**Disputed entries:**
- Findings that received a DISPUTED verdict during
  cross-validation
- Include the dispute NOTES inline

**Uncertain entries:**
- Findings that received an UNCERTAIN verdict during
  cross-validation
- Include in the output for human triage — these are
  plausible issues the validator could not confirm or
  deny from available context

## Output Formats

One template, three modes. Use the header and sections
for whichever mode applies; skip sections marked "Full
mode only." Every finding field that exists in any mode
is preserved below.

**Choosing the mode:**
- **Full mode** (default): codex available, `--quick`
  not set.
- **Quick mode**: `--quick` flag is set.
- **Claude-Only mode**: codex unavailable (script
  missing, path not configured, script exits non-zero,
  or the Claude-side reviewer Agent dispatch failed and
  Step 2 degraded to codex-only — in that case swap
  "Claude" for "Codex" throughout).

```
## Cross-Review Results[ (Quick)| (Claude Only)]

[Full/Quick mode:]
Scope: <scope description>
Claude findings: <n> | Codex findings: <n>[ | Shared: <n> — Full mode only]
[Quick mode adds:]
Note: cross-validation skipped (--quick)

[Claude-Only mode:]
WARNING: Codex unavailable — findings are not
cross-validated. Install `codex-plugin-cc` from
the `openai-codex` marketplace
(https://github.com/openai/codex-plugin-cc), or
set `codex-script:` in your project CLAUDE.md to
enable multi-model review.

Scope: <scope description>
Claude findings: <n>

### Fix List [Full mode heading; Quick mode uses
### Findings; Claude-Only mode uses ### Findings]

<Full mode: each confirmed finding, severity order.
Quick mode: union of both models' findings,
deduplicated, severity order. Claude-Only mode: all
Claude findings, severity order.>

FINDING: <id>
FILE: <path>
LINES: <range>
SEVERITY: <level>
CATEGORY: <category>
ISSUE: <summary>
DETAIL: <explanation>
RECOMMENDATION: <fix>
CONFIRMED_BY: <claude|codex|both — Full mode only>
SOURCE: <claude|codex|both — Quick mode only>
RELATED_TO: <finding id, optional — only if this
             finding overlaps in location with another
             finding but was kept separate because
             they describe distinct bugs; Full and
             Quick modes only>

[Full mode only, if any disputed findings exist:]
### Disputed Findings

Unverified — human review needed.

<For each disputed finding:>

FINDING: <id>
FILE: <path>
LINES: <range>
SEVERITY: <level>
CATEGORY: <category>
ISSUE: <summary>
DETAIL: <explanation>
RECOMMENDATION: <fix>
STATUS: DISPUTED
DISPUTE: <validator's NOTES explaining what is wrong>
REBUTTAL: <originator's response, if --reconcile was
          used and they chose MAINTAIN>

Note: if --reconcile was used, findings where the
originator conceded are removed from this list.

[Full mode only, if any uncertain findings exist:]
### Uncertain Findings

Could not verify — human triage needed.

<For each uncertain finding:>

FINDING: <id>
FILE: <path>
LINES: <range>
SEVERITY: <level>
CATEGORY: <category>
ISSUE: <summary>
DETAIL: <explanation>
RECOMMENDATION: <fix>
STATUS: UNCERTAIN
NOTES: <what additional context would resolve this>
```
