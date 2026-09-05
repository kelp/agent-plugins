export const HARNESSES = ["claude", "codex", "grok"];

const HARNESS_SET = new Set(HARNESSES);

const SEVERITY_HIGH = new Set([
  "critical",
  "high",
  "bug",
  "important",
  "normal"
]);
const SEVERITY_MEDIUM = new Set(["medium", "suggestion"]);
const SEVERITY_LOW = new Set(["low", "nit", "pre-existing", "pre_existing"]);

export function parseCallees(tokens) {
  const joined = tokens
    .flatMap((t) => String(t).split(/[,\s]+/))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (joined.length === 0) return [...HARNESSES];
  const seen = new Set();
  const out = [];
  for (const name of joined) {
    if (!HARNESS_SET.has(name)) {
      throw new Error(
        `unknown harness '${name}'. Use: ${HARNESSES.join(", ")}`
      );
    }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function parseTarget(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { kind: "working-tree" };
  }
  const value = String(raw).trim();
  if (value === "working-tree") return { kind: "working-tree" };
  const branch = value.match(/^branch:(.+)$/);
  if (branch) {
    const ref = branch[1].trim();
    if (!ref) throw new Error("target branch: needs a ref");
    return { kind: "branch", ref };
  }
  const commit = value.match(/^commit:([0-9a-fA-F]+)$/);
  if (commit) return { kind: "commit", sha: commit[1] };
  const pr = value.match(/^pr:#?(\d+)$/i);
  if (pr) return { kind: "pr", number: Number(pr[1]) };
  throw new Error(
    `invalid target '${value}'. Use working-tree, branch:<ref>, commit:<sha>, or pr:<n>`
  );
}

export function normalizeSeverity(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (SEVERITY_HIGH.has(value)) return "high";
  if (SEVERITY_MEDIUM.has(value)) return "medium";
  if (SEVERITY_LOW.has(value)) return "low";
  return "medium";
}

function finding(partial) {
  return {
    file: partial.file ?? "",
    line: Number(partial.line) || 0,
    severity: normalizeSeverity(partial.severity),
    title: String(partial.title ?? "").trim(),
    body: String(partial.body ?? "").trim()
  };
}

function tryParseJson(raw) {
  const text = String(raw).trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseOpenAiFindings(data) {
  if (!data || typeof data !== "object") return null;
  if (!Array.isArray(data.findings)) return null;
  const findings = data.findings.map((item) =>
    finding({
      file: item.file,
      line: item.line_start ?? item.line,
      severity: item.severity,
      title: item.title ?? item.issue,
      body: [item.body, item.detail, item.recommendation]
        .filter(Boolean)
        .join("\n")
    })
  );
  return {
    summary: String(data.summary ?? data.verdict ?? "").trim(),
    findings
  };
}

function parseGrokMarkdown(raw) {
  const text = String(raw);
  const issues = [];
  const issueRe =
    /### Issue \d+ -- Severity: (\w+)\s*\n- File: ([^\n]+?)\s*\n- Description: ([^\n]+)/gi;
  let match;
  while ((match = issueRe.exec(text))) {
    const fileField = match[2].trim();
    const fileMatch = fileField.match(/^(.*):(\d+)$/);
    issues.push(
      finding({
        severity: match[1],
        file: fileMatch ? fileMatch[1] : fileField,
        line: fileMatch ? fileMatch[2] : 0,
        title: match[3].trim(),
        body: match[3].trim()
      })
    );
  }
  if (issues.length === 0) return null;
  const summaryMatch = text.match(/## Summary\s*\n+([\s\S]*?)(?:\n## |\n*$)/);
  return {
    summary: summaryMatch ? summaryMatch[1].trim() : "",
    findings: issues
  };
}

function parseClaudeBullets(raw) {
  const text = String(raw);
  const findings = [];
  const re = /^- \[([^\]]+)\] (.+?) \(([^:)]+):(\d+)\)\s*(?:\n  (.+))?/gm;
  let match;
  while ((match = re.exec(text))) {
    findings.push(
      finding({
        severity: match[1],
        title: match[2],
        file: match[3],
        line: match[4],
        body: match[5] ?? match[2]
      })
    );
  }
  if (findings.length === 0) return null;
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return { summary: firstLine, findings };
}

export function parseFindings(harness, raw) {
  const text = String(raw ?? "");
  const json = tryParseJson(text);
  const parsed =
    parseOpenAiFindings(json) ??
    parseGrokMarkdown(text) ??
    parseClaudeBullets(text);
  if (parsed) return parsed;
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return { summary: firstLine, findings: [] };
}

function linesOverlap(a, b) {
  const aLine = Number(a.line) || 0;
  const bLine = Number(b.line) || 0;
  if (!aLine || !bLine) return aLine === bLine;
  return Math.abs(aLine - bLine) <= 2;
}

export function mergeByLocation(results) {
  const groups = [];
  for (const result of results) {
    for (const item of result.findings ?? []) {
      const existing = groups.find(
        (g) => g.file === item.file && linesOverlap(g, item)
      );
      if (existing) {
        if (!existing.harnesses.includes(result.harness)) {
          existing.harnesses.push(result.harness);
        }
        existing.findings.push({ harness: result.harness, ...item });
      } else {
        groups.push({
          file: item.file,
          line: item.line,
          harnesses: [result.harness],
          findings: [{ harness: result.harness, ...item }]
        });
      }
    }
  }
  return groups;
}
