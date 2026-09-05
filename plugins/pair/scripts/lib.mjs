// Pure logic for the pair CLI. No I/O here; everything in
// this module is unit-tested by tests/lib.test.mjs.

import { createHash } from "node:crypto";

const COMMANDS = new Set([
  "start", "send", "list", "end",
  "design-register", "design-agree", "design-amend",
  "review-start", "review-complete", "override-cap", "snapshot",
  "judge"
]);

const KINDS = new Set(["design", "review", "freeform"]);
const OUTCOMES = new Set(["approved", "user-decided"]);
export const VERDICTS = new Set(["claude", "codex", "split", "unresolved"]);

// codex 0.145 rejects danger-full-access only behind an extra flag;
// a pair partner never needs it, so we refuse it outright.
const SANDBOXES = new Set(["read-only", "workspace-write"]);
const HARNESSES = new Set(["claude", "codex", "grok"]);
const TRANSPORTS = new Set(["pool", "exec"]);

export function designArtifactPath(label, { legacy = false } = {}) {
  const dir = legacy ? ".codex-pair" : ".pair";
  return `${dir}/design-${label}.md`;
}

export function isDesignArtifactPath(label, given) {
  return (
    given === designArtifactPath(label) ||
    given === designArtifactPath(label, { legacy: true })
  );
}

export function resolveStateFile(env, home, exists) {
  if (env.PAIR_STATE_FILE) return env.PAIR_STATE_FILE;
  if (env.CODEX_PAIR_STATE_FILE) return env.CODEX_PAIR_STATE_FILE;
  const neu = `${home}/.claude/pair/pairs.json`;
  const old = `${home}/.claude/codex-pair/pairs.json`;
  if (exists(neu)) return neu;
  if (exists(old)) return old;
  return neu;
}

export function parseCliArgs(argv) {
  if (argv.length === 0) {
    throw new Error(
      "usage: pair.mjs <start|send|list|end> [--label L] " +
        "[--harness H] [--cwd D] [--model M] [--sandbox S] [--timeout-sec N]"
    );
  }
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) {
    throw new Error(`unknown command: ${command}`);
  }
  const opts = {
    command,
    label: "default",
    harness: "codex",
    cwd: null,
    model: null,
    sandbox: "read-only",
    transport: null,
    timeoutSec: 600,
    kind: null,
    cycleId: null,
    snapshotId: null,
    path: null,
    outcome: null,
    verdict: null
  };
  const known = new Set([
    "--label", "--harness", "--cwd", "--model", "--sandbox",
    "--timeout-sec", "--transport",
    "--kind", "--cycle-id", "--snapshot-id", "--path", "--outcome",
    "--verdict"
  ]);
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (!known.has(flag)) {
      throw new Error(`unknown flag: ${flag}`);
    }
    if (value === undefined) {
      throw new Error(`missing value for ${flag}`);
    }
    switch (flag) {
      case "--label":
        if (!/^[A-Za-z0-9._-]+$/.test(value)) {
          throw new Error(
            "invalid label: use only letters, digits, dot, dash, underscore"
          );
        }
        opts.label = value;
        break;
      case "--harness":
        if (!HARNESSES.has(value)) {
          throw new Error(
            `harness must be one of: ${[...HARNESSES].join(", ")}`
          );
        }
        opts.harness = value;
        break;
      case "--transport":
        if (!TRANSPORTS.has(value)) {
          throw new Error("transport must be pool or exec");
        }
        opts.transport = value;
        break;
      case "--cwd":
        opts.cwd = value;
        break;
      case "--model":
        opts.model = value;
        break;
      case "--sandbox":
        if (!SANDBOXES.has(value)) {
          throw new Error(
            `sandbox must be one of: ${[...SANDBOXES].join(", ")}`
          );
        }
        opts.sandbox = value;
        break;
      case "--timeout-sec":
        opts.timeoutSec = Number(value);
        if (!Number.isFinite(opts.timeoutSec) || opts.timeoutSec <= 0) {
          throw new Error("--timeout-sec must be a positive number");
        }
        break;
      case "--kind":
        if (!KINDS.has(value)) {
          throw new Error(`--kind must be one of: ${[...KINDS].join(", ")}`);
        }
        opts.kind = value;
        break;
      case "--cycle-id":
        opts.cycleId = Number(value);
        if (!Number.isInteger(opts.cycleId) || opts.cycleId < 1) {
          throw new Error("--cycle-id must be a positive integer");
        }
        break;
      case "--snapshot-id":
        opts.snapshotId = value;
        break;
      case "--path":
        opts.path = value;
        break;
      case "--outcome":
        if (!OUTCOMES.has(value)) {
          throw new Error(
            `--outcome must be one of: ${[...OUTCOMES].join(", ")}`
          );
        }
        opts.outcome = value;
        break;
      case "--verdict":
        if (!VERDICTS.has(value)) {
          throw new Error(
            `--verdict must be one of: ${[...VERDICTS].join(", ")}`
          );
        }
        opts.verdict = value;
        break;
    }
  }
  if (command === "send" && !opts.kind) {
    throw new Error("send requires --kind design|review|freeform");
  }
  if (command === "override-cap" && !opts.kind) {
    throw new Error("override-cap requires --kind design|review");
  }
  if (command === "judge") {
    if (!opts.kind) throw new Error("judge requires --kind design|review");
    if (!opts.verdict) {
      throw new Error(
        `judge requires --verdict ${[...VERDICTS].join("|")}`
      );
    }
  }
  return opts;
}

// Parse `codex exec --json` JSONL events. Returns the thread id,
// the last agent message, and any error events.
export function parseEvents(text) {
  const result = { threadId: null, lastMessage: null, errors: [] };
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event.type === "thread.started" && event.thread_id) {
      result.threadId = event.thread_id;
    } else if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message"
    ) {
      result.lastMessage = event.item.text;
    } else if (event.type === "error") {
      result.errors.push(event.message ?? JSON.stringify(event));
    }
  }
  return result;
}

// Event fields are untrusted model/tool output headed for a
// terminal: strip control characters (C0, DEL, C1 — covers ESC/CSI/
// OSC sequences' introducers), collapse whitespace, cap length.
function sanitize(value, max = 80) {
  return String(value)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const LINE_CAP = 100;

// One compact line per interesting codex event, streamed to
// stderr so a backgrounded send shows live progress. Returns
// null for events not worth a line. Every branch sanitizes and
// the final cap applies to the whole line.
export function renderEventLine(event) {
  let line;
  switch (event?.type) {
    case "thread.started":
      line = `thread ${sanitize(event.thread_id)}`;
      break;
    case "turn.completed": {
      const u = event.usage ?? {};
      line = `turn done (in ${sanitize(u.input_tokens ?? "?")}, ` +
        `out ${sanitize(u.output_tokens ?? "?")} tokens)`;
      break;
    }
    case "turn.failed":
      line = `turn failed: ${sanitize(event.error?.message ?? "unknown")}`;
      break;
    case "item.completed": {
      const item = event.item ?? {};
      const detail = sanitize(item.command ?? item.title ?? item.text ?? "");
      line = `${sanitize(item.type ?? "item")}: ${detail}`;
      break;
    }
    default:
      return null;
  }
  return line.slice(0, LINE_CAP);
}

export function getPair(state, label) {
  return state.pairs.find((p) => p.label === label);
}

export function upsertPair(state, pair) {
  const pairs = state.pairs.filter((p) => p.label !== pair.label);
  pairs.push(pair);
  return { ...state, pairs };
}

export function removePair(state, label) {
  if (!getPair(state, label)) {
    const labels = state.pairs.map((p) => p.label).join(", ") || "none";
    throw new Error(`no pair named '${label}' (have: ${labels})`);
  }
  return { ...state, pairs: state.pairs.filter((p) => p.label !== label) };
}

// In-flight tokens serialize whole operations per label, not just
// state mutations: codex appends rollout events without file
// locking, so two concurrent resumes of one thread can interleave
// its conversation history. A token claimed under the state lock
// makes the second operation fail fast instead. Tokens carry an
// expiry (the operation's own timeout plus grace) so a crashed
// owner never wedges the label.

export function isInFlight(pair, nowMs) {
  return Boolean(
    pair?.inFlight && Date.parse(pair.inFlight.expiresAt) > nowMs
  );
}

export function claimInFlight(state, label, token, nowMs) {
  const pair = getPair(state, label);
  if (!pair) {
    const labels = state.pairs.map((p) => p.label).join(", ") || "none";
    throw new Error(`no pair named '${label}' (have: ${labels})`);
  }
  if (isInFlight(pair, nowMs)) {
    throw new Error(
      `an operation is already in flight for '${label}' ` +
        `(pid ${pair.inFlight.pid}, expires ${pair.inFlight.expiresAt}); ` +
        "wait for it to finish"
    );
  }
  return upsertPair(state, { ...pair, inFlight: token });
}

export function releaseInFlight(state, label, pid) {
  const pair = getPair(state, label);
  if (!pair || pair.inFlight?.pid !== pid) return state;
  const { inFlight, ...rest } = pair;
  return upsertPair(state, rest);
}

// Post-send bookkeeping, keyed on (label, threadId): if the pair
// was ended and its label reused by a new thread while the send
// was in flight, leave the new pair untouched.
export function applySendUpdate(state, label, threadId, now) {
  const fresh = getPair(state, label);
  if (!fresh || fresh.threadId !== threadId) return state;
  return upsertPair(state, { ...fresh, lastUsedAt: now, turns: fresh.turns + 1 });
}

export function buildStartArgs({ sandbox, model }) {
  const args = ["exec", "--json", "--skip-git-repo-check", "-s", sandbox];
  if (model) args.push("-m", model);
  args.push("-");
  return args;
}

// `codex exec resume` accepts no -s or -C flags (codex 0.145);
// sandbox and working root come from the recorded session. We set
// the child process cwd instead of -C in both commands.
export function buildSendArgs(threadId, { model }) {
  const args = ["exec", "resume", threadId, "--json", "--skip-git-repo-check"];
  if (model) args.push("-m", model);
  args.push("-");
  return args;
}

// --- v0.3.0 state machine (schema v2) ------------------------------
//
// Design/review lifecycle, typed counted sends, per-kind caps, and
// snapshot assembly. Every function is pure: state comes in, a new
// state (or {state, ...}) comes out, and timestamps arrive as
// arguments. I/O (hashing files, running git, Date.now) stays in the
// CLI layer.

export const DESIGN_CAP = 5;
export const REVIEW_CAP = 4;

// Bounds on the serialized `omitted` list: at most this many entries
// and this many bytes, whichever comes first.
const OMIT_SERIAL_CAP = 8 * 1024;

function requirePair(state, label) {
  const pair = getPair(state, label);
  if (!pair) {
    const labels = state.pairs.map((p) => p.label).join(", ") || "none";
    throw new Error(`no pair named '${label}' (have: ${labels})`);
  }
  return pair;
}

// Bytewise (not code-point) ordering, so paths sort the way Git
// emits them and snapshot ids stay stable across locales.
function bytewiseCompare(a, b) {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

// `loadState` treats absent or `1` as v1 and migrates in memory to
// v2; the migrated state persists on the next save. Bad versions
// reject with named errors.
export function migrateState(raw) {
  const v = raw.schemaVersion;
  if (v !== undefined) {
    if (!Number.isInteger(v)) {
      throw new Error(
        `schemaVersion must be an integer (non-integer: ${JSON.stringify(v)})`
      );
    }
    if (v < 1) throw new Error(`schemaVersion ${v} is below 1`);
    if (v > 2) throw new Error(`unsupported schema version ${v}`);
  }
  const pairs = (raw.pairs ?? []).map((p) => ({
    designRounds: 0,
    capState: {},
    capOverrides: [],
    judgeRulings: [],
    ...p
  }));
  return { ...raw, schemaVersion: 2, pairs };
}

// design-register: create or update the draft record. Reset
// designRounds only on the initial draft (no record yet); updating
// an existing record preserves the counter. Refuses to overwrite an
// agreed design, pointing at design-amend.
export function registerDesign(state, label, { path, sha256 }) {
  const pair = requirePair(state, label);
  if (pair.design?.status === "agreed") {
    throw new Error(
      `design for '${label}' is agreed; run design-amend before ` +
        `re-registering`
    );
  }
  if (pair.design) {
    const design = { ...pair.design, path, sha256 };
    return upsertPair(state, { ...pair, design });
  }
  const design = { path, sha256, revision: 0, status: "draft" };
  return upsertPair(state, { ...pair, design, designRounds: 0 });
}

// design-agree: move draft/amending to agreed with the recomputed
// hash and bump revision (first agreement is revision 1). Clears the
// design cap for its kind.
export function agreeDesign(state, label, currentSha) {
  const pair = requirePair(state, label);
  if (!pair.design) {
    throw new Error(`no design registered for '${label}'`);
  }
  if (pair.design.status === "agreed") {
    throw new Error(
      `design for '${label}' is already agreed; run design-amend to change it`
    );
  }
  const design = {
    ...pair.design,
    sha256: currentSha,
    status: "agreed",
    revision: pair.design.revision + 1
  };
  const capState = { ...pair.capState };
  delete capState.design;
  const capPermits = { ...pair.capPermits };
  delete capPermits.design;
  return upsertPair(state, { ...pair, design, capState, capPermits });
}

// design-amend: reopen the design and atomically clear design and
// review caps, the active review cycle, and both round counters.
export function amendDesign(state, label) {
  const pair = requirePair(state, label);
  if (!pair.design) {
    throw new Error(`no design registered for '${label}'`);
  }
  const design = { ...pair.design, status: "amending" };
  const review = { ...pair.review, activeCycleId: undefined, reviewRounds: 0 };
  return upsertPair(state, {
    ...pair,
    design,
    designRounds: 0,
    capState: {},
    capPermits: {},
    review
  });
}

// review-start: requires an agreed design and no active cycle;
// issues a stable monotonic cycleId and resets reviewRounds.
export function startReviewCycle(state, label) {
  const pair = requirePair(state, label);
  if (pair.design?.status !== "agreed") {
    throw new Error(
      `design for '${label}' is not agreed; agree the design before ` +
        `starting a review cycle`
    );
  }
  const active = pair.review?.activeCycleId;
  if (active !== undefined && active !== null) {
    throw new Error(
      `a review cycle (${active}) is already active for '${label}'`
    );
  }
  const cycleId = (pair.review?.lastCycleId ?? 0) + 1;
  const review = {
    ...pair.review,
    activeCycleId: cycleId,
    lastCycleId: cycleId,
    reviewRounds: 0
  };
  return { state: upsertPair(state, { ...pair, review }), cycleId };
}

// review-complete: records the outcome, clears the active cycle,
// reviewRounds, and the review cap. Cycles end only here or via
// design-amend.
export function completeReviewCycle(state, label, cycleId, outcome, decision, at) {
  const pair = requirePair(state, label);
  if (pair.review?.activeCycleId !== cycleId) {
    throw new Error(
      `cycle ${cycleId} is not the active review cycle for '${label}'`
    );
  }
  const record = { cycleId, outcome, at };
  if (decision != null) record.decision = decision;
  const review = {
    ...pair.review,
    activeCycleId: undefined,
    reviewRounds: 0,
    history: [...(pair.review.history ?? []), record]
  };
  const capState = { ...pair.capState };
  delete capState.review;
  const capPermits = { ...pair.capPermits };
  delete capPermits.review;
  return upsertPair(state, { ...pair, review, capState, capPermits });
}

// Record a successful counted codex turn. design increments
// designRounds; review increments reviewRounds and requires
// meta.cycleId to match the active cycle. Reaching a cap flips
// capState[kind] to decisionRequired and returns a disagreement
// packet skeleton. While decisionRequired, each counted send of that
// kind consumes one permit (granted by override-cap) or fails
// pointing at override-cap. Freeform is uncounted.
export function recordCountedSend(state, label, kind, meta = {}) {
  const pair = requirePair(state, label);
  if (kind === "freeform") return { state };
  if (kind !== "design" && kind !== "review") {
    throw new Error(`unknown send kind: ${kind}`);
  }
  const cap = kind === "design" ? DESIGN_CAP : REVIEW_CAP;

  if (kind === "review") {
    const active = pair.review?.activeCycleId;
    if (active === undefined || active === null || meta.cycleId !== active) {
      throw new Error(
        `review send requires --cycle-id matching the active review ` +
          `cycle for '${label}'`
      );
    }
  }

  const capState = { ...pair.capState };
  const capPermits = { ...pair.capPermits };
  if (capState[kind] === "decisionRequired") {
    if ((capPermits[kind] ?? 0) > 0) {
      capPermits[kind] -= 1;
    } else {
      throw new Error(
        `${kind} cap reached for '${label}'; run override-cap --label ` +
          `${label} --kind ${kind} with the user's decision to continue`
      );
    }
  }

  let count;
  let next;
  if (kind === "design") {
    count = (pair.designRounds ?? 0) + 1;
    next = { ...pair, designRounds: count };
  } else {
    count = (pair.review.reviewRounds ?? 0) + 1;
    next = {
      ...pair,
      review: {
        ...pair.review,
        reviewRounds: count,
        roundSnapshots: [
          ...(pair.review.roundSnapshots ?? []),
          {
            cycleId: pair.review.activeCycleId,
            snapshotId: meta.snapshotId ?? null
          }
        ]
      }
    };
  }

  let disagreementPacket;
  if (count === cap) {
    capState[kind] = "decisionRequired";
    disagreementPacket = {
      kind,
      rounds: count,
      positions: { claude: null, codex: null },
      evidence: null,
      decisionNeeded: true
    };
  }
  next = { ...next, capState, capPermits };
  const result = { state: upsertPair(state, next) };
  if (disagreementPacket) result.disagreementPacket = disagreementPacket;
  return result;
}

// override-cap: append the user's decision to capOverrides and grant
// one single-use permit, consumed by the next counted send of the
// kind.
export function overrideCap(state, label, kind, decision, at) {
  const pair = requirePair(state, label);
  if (kind !== "design" && kind !== "review") {
    throw new Error(`override-cap kind must be design or review, got ${kind}`);
  }
  if (pair.capState?.[kind] !== "decisionRequired") {
    throw new Error(
      `no ${kind} cap decision is required for '${label}'; ` +
        "override-cap only applies at a reached cap"
    );
  }
  const capOverrides = [...(pair.capOverrides ?? []), { at, kind, decision }];
  const capPermits = { ...pair.capPermits };
  capPermits[kind] = (capPermits[kind] ?? 0) + 1;
  return upsertPair(state, { ...pair, capOverrides, capPermits });
}

// judge: append a third-model ruling to the pair's audit log. Purely
// advisory — it never touches capState or capPermits, so only the
// user's override-cap grants another round. The log survives
// design-amend and cycle completion; it is the record of who was
// judged right, not a lever on the state machine.
export function recordJudgeRuling(state, label, kind, { verdict, ruling }, at) {
  const pair = requirePair(state, label);
  if (kind !== "design" && kind !== "review") {
    throw new Error(`judge kind must be design or review, got ${kind}`);
  }
  if (!VERDICTS.has(verdict)) {
    throw new Error(
      `judge verdict must be one of: ${[...VERDICTS].join(", ")}`
    );
  }
  const text = String(ruling ?? "").trim();
  if (!text) throw new Error("judge requires the ruling text");
  const record = {
    at,
    kind,
    rounds: kind === "design"
      ? (pair.designRounds ?? 0)
      : (pair.review?.reviewRounds ?? 0),
    verdict,
    ruling: text
  };
  if (kind === "review") {
    const active = pair.review?.activeCycleId;
    if (active !== undefined && active !== null) record.cycleId = active;
  }
  const judgeRulings = [...(pair.judgeRulings ?? []), record];
  return upsertPair(state, { ...pair, judgeRulings });
}

// Gate on review-kind sends: agreed design, stored hash matching the
// current file, and the path still present. Each failure names the
// specific violation and points at design-amend. ctx carries the
// caller's I/O results {currentSha, pathExists}.
export function checkReviewSendPreconditions(pair, ctx) {
  const design = pair.design;
  if (!design || design.status !== "agreed") {
    throw new Error(
      `no agreed design; run design-register and design-agree ` +
        `(or design-amend to revise) before review sends`
    );
  }
  if (!ctx.pathExists) {
    throw new Error(
      `design file path no longer exists; run design-amend to ` +
        `re-register before review sends`
    );
  }
  if (ctx.currentSha !== design.sha256) {
    throw new Error(
      `design file hash changed since agreement; run design-amend ` +
        `to revise before review sends`
    );
  }
}

// Canonical serialization of the omitted list for hashing and the
// serialized-size bound: entries sorted bytewise by path, keys in
// fixed order (path, bytes, reason), no insignificant whitespace.
export function canonicalOmitted(entries) {
  const paths = entries.filter((e) => !e.aggregate);
  const aggregates = entries.filter((e) => e.aggregate);
  const sorted = [...paths].sort((a, b) =>
    Buffer.compare(gitCUnquote(a.path), gitCUnquote(b.path)));
  const items = sorted.map(
    (e) =>
      `{"path":${JSON.stringify(e.path)},"bytes":${e.bytes},` +
      `"reason":${JSON.stringify(e.reason)}}`
  );
  for (const a of aggregates) {
    items.push(
      `{"aggregate":{"omittedFiles":${a.aggregate.omittedFiles},` +
        `"omittedBytes":${a.aggregate.omittedBytes}}}`
    );
  }
  return `[${items.join(",")}]`;
}

function utf8Len(s) {
  return Buffer.byteLength(s, "utf8");
}

// Canonical Git C-style quoting: named escapes for the bytes Git
// names, octal escapes for every other byte outside printable
// ASCII, surrounding quotes only when any escape fired.
const GIT_QUOTE_SPECIALS = new Map([
  [0x07, "\\a"], [0x08, "\\b"], [0x09, "\\t"], [0x0a, "\\n"],
  [0x0b, "\\v"], [0x0c, "\\f"], [0x0d, "\\r"],
  [0x22, '\\"'], [0x5c, "\\\\"]
]);

// Inverse of gitCQuote: recover the raw path bytes from a quoted
// display string, for byte-correct canonical ordering.
const GIT_UNQUOTE_SPECIALS = new Map([
  ["a", 0x07], ["b", 0x08], ["t", 0x09], ["n", 0x0a],
  ["v", 0x0b], ["f", 0x0c], ["r", 0x0d], ['"', 0x22], ["\\", 0x5c]
]);

export function gitCUnquote(display) {
  if (!display.startsWith('"')) return Buffer.from(display, "latin1");
  const inner = display.slice(1, -1);
  const out = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== "\\") {
      out.push(c.charCodeAt(0));
      continue;
    }
    const next = inner[i + 1];
    const named = GIT_UNQUOTE_SPECIALS.get(next);
    if (named !== undefined) {
      out.push(named);
      i += 1;
    } else {
      out.push(parseInt(inner.slice(i + 1, i + 4), 8));
      i += 3;
    }
  }
  return Buffer.from(out);
}

export function gitCQuote(bytes) {
  let s = "";
  let quoted = false;
  for (const b of bytes) {
    const special = GIT_QUOTE_SPECIALS.get(b);
    if (special !== undefined) {
      s += special;
      quoted = true;
    } else if (b >= 0x20 && b <= 0x7e) {
      s += String.fromCharCode(b);
    } else {
      s += "\\" + b.toString(8).padStart(3, "0");
      quoted = true;
    }
  }
  return quoted ? `"${s}"` : s;
}

// Assemble the patch field from per-path pieces in bytewise path
// order. Binary pieces contribute a one-line marker. Pieces are
// appended until the next would overflow capBytes; every remaining
// path goes to `omitted` ({path, bytes, reason:"size"}), which is
// bounded to omitEntries entries and 8 KB serialized, whichever comes
// first, with the remainder summarized in `aggregate`.
export function assembleSnapshot(pieces, { capBytes, omitEntries = 100 }) {
  const sorted = [...pieces].sort((a, b) =>
    bytewiseCompare(a.sortKey ?? a.path, b.sortKey ?? b.path));

  let patch = "";
  let patchBytes = 0;
  let stopped = false;
  const overflow = [];
  for (const p of sorted) {
    if (p.forceOmit) {
      stopped = true;
      overflow.push({
        path: p.path,
        bytes: p.bytes,
        reason: p.reason ?? "size"
      });
      continue;
    }
    const chunk = p.binary
      ? `Binary file ${p.path} differs (${p.bytes} bytes)\n`
      : p.text ?? "";
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    if (!stopped && patchBytes + chunkBytes <= capBytes) {
      patch += chunk;
      patchBytes += chunkBytes;
    } else {
      stopped = true;
      overflow.push({ path: p.path, bytes: p.bytes, reason: "size" });
    }
  }

  // Aggregate only when truncation is necessary. First try the
  // whole overflow list against both limits; when it does not fit,
  // keep the longest prefix whose FINAL serialization (prefix plus
  // the aggregate entry covering the remainder) satisfies both the
  // entry count and the UTF-8 byte cap.
  let omitted = overflow.map((o) => ({ ...o }));
  const fitsWhole =
    omitted.length <= omitEntries &&
    utf8Len(canonicalOmitted(omitted)) <= OMIT_SERIAL_CAP;
  if (!fitsWhole && omitted.length > 0) {
    let chosen = null;
    for (let n = Math.min(overflow.length, omitEntries - 1); n >= 0; n--) {
      const kept = overflow.slice(0, n);
      const rest = overflow.slice(n);
      const trial = [
        ...kept,
        {
          aggregate: {
            omittedFiles: rest.length,
            omittedBytes: rest.reduce((a, b) => a + b.bytes, 0)
          }
        }
      ];
      if (
        trial.length <= omitEntries &&
        utf8Len(canonicalOmitted(trial)) <= OMIT_SERIAL_CAP
      ) {
        chosen = trial;
        break;
      }
    }
    omitted = chosen ?? [];
  }

  const result = { patch, omitted, warning: null };
  if (overflow.length > 0) {
    result.warning =
      `${overflow.length} path(s) omitted from the snapshot patch ` +
      `(size cap ${capBytes} bytes)`;
  }
  return result;
}

// snapshotId = SHA-256 hex over the exact patch bytes plus the
// canonical omitted serialization. Identical worktrees yield
// byte-identical input and thus the same id.
export function snapshotIdFor(patch, omitted) {
  const hash = createHash("sha256");
  hash.update(Buffer.from(patch, "utf8"));
  hash.update(Buffer.from(canonicalOmitted(omitted ?? []), "utf8"));
  return hash.digest("hex");
}
