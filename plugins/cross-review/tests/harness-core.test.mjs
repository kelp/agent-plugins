import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCallees,
  parseTarget,
  parseFindings,
  mergeByLocation
} from "../scripts/harness/core.mjs";

test("parseCallees defaults to all three in stable order", () => {
  assert.deepEqual(parseCallees([]), ["claude", "codex", "grok"]);
  assert.deepEqual(parseCallees([""]), ["claude", "codex", "grok"]);
});

test("parseCallees keeps unique names in caller order", () => {
  assert.deepEqual(parseCallees(["grok", "claude"]), ["grok", "claude"]);
  assert.deepEqual(parseCallees(["grok,codex,grok"]), ["grok", "codex"]);
});

test("parseCallees rejects unknown names", () => {
  assert.throws(() => parseCallees(["cursor"]), /unknown harness/i);
});

test("parseTarget defaults to working-tree", () => {
  assert.deepEqual(parseTarget(null), { kind: "working-tree" });
  assert.deepEqual(parseTarget("working-tree"), { kind: "working-tree" });
});

test("parseTarget reads branch, commit, and pr forms", () => {
  assert.deepEqual(parseTarget("branch:main"), { kind: "branch", ref: "main" });
  assert.deepEqual(parseTarget("commit:abc123"), { kind: "commit", sha: "abc123" });
  assert.deepEqual(parseTarget("pr:42"), { kind: "pr", number: 42 });
});

test("parseTarget rejects empty refs", () => {
  assert.throws(() => parseTarget("branch:"), /target/i);
  assert.throws(() => parseTarget("nope"), /target/i);
});

test("parseFindings reads OpenAI native JSON", () => {
  const raw = JSON.stringify({
    verdict: "needs-attention",
    summary: "One bug",
    findings: [
      {
        severity: "high",
        title: "Race",
        body: "lost update",
        file: "src/x.rs",
        line_start: 10,
        line_end: 12,
        recommendation: "lock it"
      }
    ]
  });
  const out = parseFindings("codex", raw);
  assert.equal(out.summary, "One bug");
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].file, "src/x.rs");
  assert.equal(out.findings[0].line, 10);
  assert.equal(out.findings[0].severity, "high");
  assert.equal(out.findings[0].title, "Race");
  assert.match(out.findings[0].body, /lost update/);
});

test("parseFindings reads Grok markdown issues", () => {
  const raw = `## Summary
Looks risky.

## Issues

### Issue 1 -- Severity: bug
- File: src/x.rs:10
- Description: lost update
- Suggestion: lock it
- Status: open
`;
  const out = parseFindings("grok", raw);
  assert.match(out.summary, /risky/i);
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].file, "src/x.rs");
  assert.equal(out.findings[0].line, 10);
  assert.equal(out.findings[0].severity, "high");
});

test("parseFindings reads Claude-style bullet findings", () => {
  const raw = `Correctness look.

Findings:
- [Important] Race (src/x.rs:10)
  lost update on the counter
`;
  const out = parseFindings("claude", raw);
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].file, "src/x.rs");
  assert.equal(out.findings[0].line, 10);
  assert.equal(out.findings[0].severity, "high");
  assert.equal(out.findings[0].title, "Race");
});

test("parseFindings keeps raw text when nothing matches", () => {
  const out = parseFindings("codex", "all good, ship it");
  assert.equal(out.findings.length, 0);
  assert.match(out.summary, /all good/);
});

test("mergeByLocation groups overlapping file:line from different harnesses", () => {
  const merged = mergeByLocation([
    {
      harness: "codex",
      findings: [{ file: "a.rs", line: 10, severity: "high", title: "Race", body: "a" }]
    },
    {
      harness: "grok",
      findings: [{ file: "a.rs", line: 11, severity: "medium", title: "Race", body: "b" }]
    },
    {
      harness: "claude",
      findings: [{ file: "b.rs", line: 1, severity: "low", title: "Nit", body: "c" }]
    }
  ]);
  assert.equal(merged.length, 2);
  const race = merged.find((g) => g.file === "a.rs");
  assert.deepEqual(race.harnesses.sort(), ["codex", "grok"]);
  const nit = merged.find((g) => g.file === "b.rs");
  assert.deepEqual(nit.harnesses, ["claude"]);
});
