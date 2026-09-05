#!/usr/bin/env node
// codex-pair: manage persistent Codex pairing threads.
//
// Wraps `codex exec` / `codex exec resume` and pins one Codex
// thread per pair label so a Claude Code session can hold a
// long-lived conversation with the same Codex partner. State
// lives in ~/.claude/codex-pair/pairs.json (override with
// CODEX_PAIR_STATE_FILE).
//
//   start [--label L] [--cwd D] [--model M] [--sandbox S]
//         prompt on stdin; creates the pair thread
//   send  [--label L]           prompt on stdin; continues it
//   list                        print state
//   end   [--label L]           forget the pair (thread remains
//                               on disk; `codex resume <id>` works)

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { requestHarnessBroker } from "./find-harness.mjs";
import {
  parseCliArgs,
  parseEvents,
  getPair,
  upsertPair,
  removePair,
  applySendUpdate,
  claimInFlight,
  releaseInFlight,
  isInFlight,
  buildStartArgs,
  buildSendArgs,
  renderEventLine,
  migrateState,
  registerDesign,
  agreeDesign,
  amendDesign,
  startReviewCycle,
  completeReviewCycle,
  recordCountedSend,
  overrideCap,
  recordJudgeRuling,
  checkReviewSendPreconditions,
  assembleSnapshot,
  snapshotIdFor,
  gitCQuote
} from "./lib.mjs";

const STATE_FILE =
  process.env.CODEX_PAIR_STATE_FILE ??
  path.join(homedir(), ".claude", "codex-pair", "pairs.json");

// Only a missing file means empty state. A corrupt or misshapen
// file is an error: silently treating it as empty would let the
// next `start` overwrite real pinned-thread mappings.
function loadState() {
  let text;
  try {
    text = readFileSync(STATE_FILE, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return migrateState({ pairs: [] });
    throw new Error(`cannot read ${STATE_FILE}: ${err.message}`);
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new Error(
      `${STATE_FILE} is corrupt; fix or remove it (threads survive: ` +
        "`codex resume <id>` still works)"
    );
  }
  if (!state || !Array.isArray(state.pairs)) {
    throw new Error(`${STATE_FILE} has invalid shape: pairs must be an array`);
  }
  try {
    state = migrateState(state);
  } catch (err) {
    throw new Error(`${STATE_FILE}: ${err.message}`);
  }
  for (const p of state.pairs) {
    if (
      typeof p?.label !== "string" ||
      typeof p?.threadId !== "string" ||
      typeof p?.cwd !== "string" ||
      typeof p?.turns !== "number"
    ) {
      throw new Error(
        `${STATE_FILE} has invalid shape: each pair needs ` +
          "label, threadId, cwd, turns"
      );
    }
  }
  return state;
}

const LOCK_DIR = STATE_FILE + ".lock";
const LOCK_TIMEOUT_MS = Number(
  process.env.CODEX_PAIR_LOCK_TIMEOUT_MS ?? 10_000
);
const LOCK_STALE_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireLock() {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(LOCK_DIR).mtimeMs > LOCK_STALE_MS) {
          rmdirSync(LOCK_DIR);
          continue;
        }
      } catch {
        continue; // lock vanished between checks; retry
      }
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${LOCK_DIR}; remove it if no other ` +
            "codex-pair command is running"
        );
      }
      await sleep(25);
    }
  }
}

function releaseLock() {
  try {
    rmdirSync(LOCK_DIR);
  } catch {
    // already released
  }
}

// All writes go through here: re-load fresh state under the lock
// so concurrent commands never save a stale snapshot and drop
// each other's labels. `fn` gets fresh state, returns the next
// state.
async function mutateState(fn) {
  await acquireLock();
  try {
    const next = fn(loadState());
    saveState(next);
    return next;
  } finally {
    releaseLock();
  }
}

// Write-to-temp-then-rename so a crash mid-write never leaves a
// truncated state file. Callers must hold the state lock (see
// mutateState); saveState alone does not serialize writers.
function saveState(state) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, STATE_FILE);
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString()));
    process.stdin.on("error", () => resolve(""));
  });
}

// codex is a Node launcher that spawns the native binary, so on
// timeout we must terminate the whole process group, and we must
// not settle (or release the in-flight token) until the tree is
// dead: an orphaned native process would keep appending to the
// thread's rollout file. detached:true gives the child its own
// group; SIGTERM first, SIGKILL after a grace period; reject
// only on close. External SIGTERM/SIGINT forward to the group.
const KILL_GRACE_MS = 5000;

function runCodex(args, { cwd, prompt, timeoutSec }) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "inherit"],
      detached: true
    });
    const killGroup = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {
        // group already gone
      }
    };
    let timedOut = false;
    let externallyTerminated = false;
    let escalation;
    const terminate = () => {
      killGroup("SIGTERM");
      if (!escalation) {
        escalation = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
        escalation.unref();
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutSec * 1000);
    // A child may trap SIGTERM and exit 0; cancellation must still
    // reject so a cancelled turn is never recorded as success.
    const onSignal = () => {
      externallyTerminated = true;
      terminate();
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(escalation);
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
    };
    let stdout = "";
    let lineBuf = "";
    child.stdout.on("data", (c) => {
      stdout += c;
      lineBuf += c;
      let i;
      while ((i = lineBuf.indexOf("\n")) >= 0) {
        const line = lineBuf.slice(0, i);
        lineBuf = lineBuf.slice(i + 1);
        try {
          const rendered = renderEventLine(JSON.parse(line));
          if (rendered) process.stderr.write(`[codex] ${rendered}\n`);
        } catch {
          // non-JSON line; skip
        }
      }
    });
    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
    child.on("close", (code, signal) => {
      cleanup();
      if (timedOut) {
        reject(
          new Error(
            `codex timed out after ${timeoutSec}s; process group terminated`
          )
        );
      } else if (externallyTerminated) {
        reject(new Error("codex terminated by external signal"));
      } else if (code !== 0) {
        reject(
          new Error(
            `codex exited with ${signal ? `signal ${signal}` : `code ${code}`}`
          )
        );
      } else {
        resolve(stdout);
      }
    });
    child.stdin.end(prompt);
  });
}

function output(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function wantPool(opts, harness = opts.harness) {
  if (opts.transport === "exec") return false;
  if (opts.transport === "pool") return true;
  if (process.env.HARNESS_PAIR_TRANSPORT === "exec") return false;
  if (harness && harness !== "codex") return true;
  return true;
}

async function runPooled(cwd, method, params) {
  return requestHarnessBroker(cwd, method, params);
}

// Snapshot: deterministic worktree-vs-HEAD capture per the v0.3
// design (design-0.3.0.md section 4). Pinned git flags, C locale,
// per-path assembly; the index is never modified.
const SNAPSHOT_CAP_BYTES = 300 * 1024;
const GIT_CONFIG = [
  "-c", "core.quotePath=false", "-c", "diff.renames=false"
];
const DIFF_FLAGS = ["--no-ext-diff", "--no-color", "--no-textconv"];

function takeSnapshot(pair) {
  const gitEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
  const git = (args, okCodes = [0]) => {
    try {
      return execFileSync("git", [...GIT_CONFIG, ...args], {
        cwd: pair.cwd,
        env: gitEnv,
        maxBuffer: 64 * 1024 * 1024
      });
    } catch (err) {
      if (typeof err.status === "number" && okCodes.includes(err.status)) {
        return err.stdout ?? Buffer.alloc(0);
      }
      throw new Error(`git ${args[0]} failed: ${err.message}`);
    }
  };
  // NUL-delimited discovery over raw buffers: newlines and control
  // bytes are legal in filenames and must not break splitting.
  const nulSplitRaw = (buf) => {
    const out = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0) {
        if (i > start) out.push(buf.subarray(start, i));
        start = i + 1;
      }
    }
    if (start < buf.length) out.push(buf.subarray(start));
    return out;
  };

  const tracked = nulSplitRaw(
    git(["diff", ...DIFF_FLAGS, "--name-only", "-z", "HEAD"])
  );
  const untracked = nulSplitRaw(
    git(["ls-files", "--others", "--exclude-standard", "-z"])
  );

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const sizeOf = (raw) => {
    try {
      return statSync(
        Buffer.concat([Buffer.from(pair.cwd), Buffer.from("/"), raw])
      ).size;
    } catch {
      return 0;
    }
  };

  // Byte-faithful diffing without Node argv: xargs -0 receives the
  // raw NUL-terminated pathname on stdin and builds git's argv from
  // the original bytes. Any diff larger than the patch cap can
  // never be included, so a maxBuffer overflow on the spool IS the
  // "omit for size" signal; the file itself is never the failure
  // point. git exit 1 surfaces as xargs exit 123 (used by
  // --no-index for "files differ").
  // A true spool: stdout goes to a temp file, its exact size is
  // measured, and the body is read back only when it fits the
  // patch cap. The omitted-entry byte count is therefore the real
  // diff size, deletions included, with no buffer bound in play.
  // Scoped to this snapshot; removed in the finally below so error
  // paths cannot retain large spool files.
  const spoolTmpDir = mkdtempSync(path.join(tmpdir(), "codex-pair-snap-"));
  let spoolSeq = 0;
  const spoolDiff = (gitArgs, raw, okCodes) => {
    const tmp = path.join(spoolTmpDir, `spool-${spoolSeq++}`);
    const fd = openSync(tmp, "w");
    let result;
    try {
      result = spawnSync(
        "xargs",
        ["-0", "-n", "1", "git", ...GIT_CONFIG, ...gitArgs],
        {
          cwd: pair.cwd,
          env: gitEnv,
          input: Buffer.concat([raw, Buffer.from([0])]),
          stdio: ["pipe", fd, "inherit"]
        }
      );
    } finally {
      closeSync(fd);
    }
    if (result.error) {
      throw new Error(`git diff spool failed: ${result.error.message}`);
    }
    if (result.status !== 0 && !okCodes.includes(result.status)) {
      throw new Error(`git diff spool exited with ${result.status}`);
    }
    const size = statSync(tmp).size;
    if (size > SNAPSHOT_CAP_BYTES) {
      unlinkSync(tmp);
      return { overflow: true, bytes: size };
    }
    const buf = readFileSync(tmp);
    unlinkSync(tmp);
    return { overflow: false, buf };
  };

  // Reconstruct header lines from the known raw pathname rather
  // than substring-matching git's partially escaped output: under
  // quotePath=false git still escapes quote and backslash, so a
  // name mixing non-ASCII bytes with those characters never
  // matches its unescaped form. Only the pre-hunk region is
  // touched; body lines may legitimately start with ---/+++.
  const normalizeHeaders = (text, raw) => {
    const qa = gitCQuote(Buffer.concat([Buffer.from("a/"), raw]));
    const qb = gitCQuote(Buffer.concat([Buffer.from("b/"), raw]));
    if (!qa.startsWith('"') && !qb.startsWith('"')) return text;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) break;
      if (line.startsWith("diff --git ")) {
        lines[i] = `diff --git ${qa} ${qb}`;
      } else if (line.startsWith("--- ") && line !== "--- /dev/null") {
        lines[i] = `--- ${qa}`;
      } else if (line.startsWith("+++ ") && line !== "+++ /dev/null") {
        lines[i] = `+++ ${qb}`;
      }
    }
    return lines.join("\n");
  };

  const toPiece = (raw, spooled) => {
    const display = gitCQuote(raw);
    const sortKey = raw.toString("latin1");
    if (spooled.overflow) {
      return {
        path: display, sortKey, text: "",
        bytes: spooled.bytes,
        binary: false, forceOmit: true, reason: "size"
      };
    }
    const buf = spooled.buf;
    let text = null;
    try {
      text = decoder.decode(buf);
    } catch {
      // invalid UTF-8 diff body: classify binary below
    }
    const gitSaysBinary = text !== null && /^Binary files /m.test(text);
    if (text === null || gitSaysBinary) {
      return {
        path: display, sortKey, text: null,
        bytes: sizeOf(raw), binary: true
      };
    }
    text = normalizeHeaders(text, raw);
    return {
      path: display, sortKey, text,
      bytes: Buffer.byteLength(text, "utf8"), binary: false
    };
  };

  const pieces = [];
  try {
    for (const raw of tracked) {
      pieces.push(toPiece(raw,
        spoolDiff(["diff", ...DIFF_FLAGS, "HEAD", "--"], raw, [0])));
    }
    // git --no-index exits 1 when the files differ (the normal case
    // here); GNU xargs reports that as 123, BSD xargs as 1.
    for (const raw of untracked) {
      pieces.push(toPiece(raw,
        spoolDiff(["diff", ...DIFF_FLAGS, "--no-index", "--", "/dev/null"],
          raw, [0, 1, 123])));
    }
  } finally {
    rmSync(spoolTmpDir, { recursive: true, force: true });
  }

  const assembled = assembleSnapshot(pieces, {
    capBytes: SNAPSHOT_CAP_BYTES
  });
  return {
    snapshotId: snapshotIdFor(assembled.patch, assembled.omitted),
    ...assembled
  };
}

async function main() {
  // Tree termination uses POSIX process groups (kill(-pid));
  // Windows would catch neither signal and leak the native
  // codex process past token release. Fail fast instead.
  if (process.platform === "win32") {
    throw new Error(
      "codex-pair supports macOS and Linux only (POSIX process-group " +
        "termination)"
    );
  }
  const opts = parseCliArgs(process.argv.slice(2));
  const state = loadState();

  if (opts.command === "list") {
    output(state);
    return;
  }

  if (opts.command === "end") {
    let removed;
    await mutateState((s) => {
      removed = getPair(s, opts.label);
      if (removed && isInFlight(removed, Date.now())) {
        throw new Error(
          `an operation is in flight for '${opts.label}'; ` +
            "wait for it before ending the pair"
        );
      }
      return removePair(s, opts.label);
    });
    output({ removed: removed ?? opts.label });
    return;
  }

  const requirePair = (s, label) => {
    const pair = getPair(s, label);
    if (!pair) {
      const labels = s.pairs.map((p) => p.label).join(", ") || "none";
      throw new Error(`no pair named '${label}' (have: ${labels})`);
    }
    return pair;
  };
  // Lifecycle and cap commands must not race an active send: a
  // cleared cycle or cap mid-turn would fail the successful turn's
  // bookkeeping.
  const requireIdlePair = (s, label) => {
    const pair = requirePair(s, label);
    if (isInFlight(pair, Date.now())) {
      throw new Error(
        `an operation is in flight for '${label}'; wait for it before ` +
          "changing lifecycle or cap state"
      );
    }
    return pair;
  };
  const sha256File = (p) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  // Re-resolve and re-contain the design path on every use: a file
  // or directory symlink swapped in after registration must not
  // lead reads outside the repository.
  const designFileInfo = (pair) => {
    const info = { exists: false, sha: null };
    let abs;
    try {
      const cwdReal = realpathSync(pair.cwd);
      abs = realpathSync(path.resolve(pair.cwd, pair.design.path));
      if (abs !== cwdReal && !abs.startsWith(cwdReal + path.sep)) {
        throw new Error(
          `design path resolves outside the repo: ${pair.design.path}; ` +
            "run design-amend"
        );
      }
    } catch (err) {
      if (err.message.includes("outside the repo")) throw err;
      return info;
    }
    info.exists = true;
    info.sha = sha256File(abs);
    return info;
  };

  if (opts.command === "design-register") {
    if (!opts.path) throw new Error("design-register requires --path");
    const expected = `.codex-pair/design-${opts.label}.md`;
    if (opts.path !== expected) {
      throw new Error(
        `design artifact must live at ${expected} (got ${opts.path})`
      );
    }
    let record;
    await mutateState((s) => {
      const pair = requireIdlePair(s, opts.label);
      const cwdReal = realpathSync(pair.cwd);
      let abs;
      try {
        abs = realpathSync(path.resolve(pair.cwd, opts.path));
      } catch {
        throw new Error(`design file not found: ${opts.path}`);
      }
      if (abs !== cwdReal && !abs.startsWith(cwdReal + path.sep)) {
        throw new Error(
          `design path must resolve inside the repo, got: ${opts.path}`
        );
      }
      const next = registerDesign(s, opts.label, {
        path: path.relative(cwdReal, abs),
        sha256: sha256File(abs)
      });
      record = getPair(next, opts.label).design;
      return next;
    });
    output({ label: opts.label, design: record });
    return;
  }

  if (opts.command === "design-agree") {
    let record;
    await mutateState((s) => {
      const pair = requireIdlePair(s, opts.label);
      if (!pair.design) {
        throw new Error("no design registered; run design-register first");
      }
      const info = designFileInfo(pair);
      if (!info.exists) {
        throw new Error(
          `design file missing at ${pair.design.path}; re-register it`
        );
      }
      const next = agreeDesign(s, opts.label, info.sha);
      record = getPair(next, opts.label).design;
      return next;
    });
    output({ label: opts.label, design: record });
    return;
  }

  if (opts.command === "design-amend") {
    let record;
    await mutateState((s) => {
      requireIdlePair(s, opts.label);
      const next = amendDesign(s, opts.label);
      record = getPair(next, opts.label).design;
      return next;
    });
    output({ label: opts.label, design: record });
    return;
  }

  if (opts.command === "review-start") {
    let cycleId;
    await mutateState((s) => {
      requireIdlePair(s, opts.label);
      const r = startReviewCycle(s, opts.label);
      cycleId = r.cycleId;
      return r.state;
    });
    output({ label: opts.label, cycleId });
    return;
  }

  if (opts.command === "review-complete") {
    if (!opts.cycleId || !opts.outcome) {
      throw new Error("review-complete requires --cycle-id and --outcome");
    }
    let decision = null;
    if (opts.outcome === "user-decided") {
      decision = (await readStdin()).trim();
      if (!decision) {
        throw new Error(
          "review-complete --outcome user-decided requires the user's " +
            "decision text on stdin"
        );
      }
    }
    await mutateState((s) => {
      requireIdlePair(s, opts.label);
      return completeReviewCycle(
        s, opts.label, opts.cycleId, opts.outcome, decision,
        new Date().toISOString()
      );
    });
    output({ label: opts.label, cycleId: opts.cycleId, outcome: opts.outcome });
    return;
  }

  if (opts.command === "override-cap") {
    const decision = (await readStdin()).trim();
    if (!decision) {
      throw new Error(
        "override-cap requires the user's decision text on stdin"
      );
    }
    await mutateState((s) => {
      requireIdlePair(s, opts.label);
      return overrideCap(
        s, opts.label, opts.kind, decision, new Date().toISOString()
      );
    });
    output({ label: opts.label, kind: opts.kind, recorded: true });
    return;
  }

  if (opts.command === "judge") {
    const ruling = (await readStdin()).trim();
    if (!ruling) {
      throw new Error("judge requires the ruling text on stdin");
    }
    let record;
    await mutateState((s) => {
      requireIdlePair(s, opts.label);
      const next = recordJudgeRuling(
        s, opts.label, opts.kind,
        { verdict: opts.verdict, ruling },
        new Date().toISOString()
      );
      const rulings = getPair(next, opts.label).judgeRulings;
      record = rulings[rulings.length - 1];
      return next;
    });
    output({ label: opts.label, ...record, recorded: true });
    return;
  }

  if (opts.command === "snapshot") {
    const pair = requirePair(state, opts.label);
    output(takeSnapshot(pair));
    return;
  }

  const prompt = await readStdin();
  if (!prompt.trim()) {
    throw new Error(`${opts.command} requires a prompt on stdin`);
  }

  if (opts.command === "start") {
    if (getPair(state, opts.label)) {
      throw new Error(
        `pair '${opts.label}' already exists; use send, or end it first`
      );
    }
    const cwd = opts.cwd ?? process.cwd();
    let events;
    if (wantPool(opts)) {
      try {
        const pooled = await runPooled(cwd, "pair/start", {
          harness: opts.harness,
          label: opts.label,
          prompt
        });
        events = {
          threadId: pooled.sessionId,
          lastMessage: pooled.lastMessage,
          errors: []
        };
      } catch (err) {
        if (opts.harness !== "codex" || opts.transport === "pool") throw err;
      }
    }
    if (!events) {
      const stdout = await runCodex(buildStartArgs(opts), {
        cwd,
        prompt,
        timeoutSec: opts.timeoutSec
      });
      events = parseEvents(stdout);
    }
    if (!events.threadId) {
      throw new Error(
        `codex returned no thread id; errors: ${events.errors.join("; ")}`
      );
    }
    const now = new Date().toISOString();
    await mutateState((s) => {
      if (getPair(s, opts.label)) {
        throw new Error(
          `pair '${opts.label}' was created concurrently; ` +
            `orphaned thread: codex resume ${events.threadId}`
        );
      }
      return upsertPair(s, {
        label: opts.label,
        harness: opts.harness,
        threadId: events.threadId,
        cwd,
        model: opts.model,
        sandbox: opts.sandbox,
        createdAt: now,
        lastUsedAt: now,
        turns: 1,
        designRounds: 0,
        capState: {},
        capOverrides: []
      });
    });
    output({
      label: opts.label,
      threadId: events.threadId,
      lastMessage: events.lastMessage,
      errors: events.errors
    });
    return;
  }

  // send: claim the label's in-flight token before touching the
  // codex thread, so overlapping sends fail fast instead of
  // interleaving appends into one rollout file.
  const expiresAt = new Date(
    Date.now() + (opts.timeoutSec + 60) * 1000
  ).toISOString();
  let pair;
  await mutateState((s) => {
    const claimed = claimInFlight(
      s,
      opts.label,
      { pid: process.pid, expiresAt },
      Date.now()
    );
    pair = getPair(claimed, opts.label);
    if (opts.kind === "review") {
      if (!opts.cycleId || !opts.snapshotId) {
        throw new Error("review sends require --cycle-id and --snapshot-id");
      }
      let currentSha = null;
      let pathExists = false;
      if (pair.design) {
        const info = designFileInfo(pair);
        pathExists = info.exists;
        currentSha = info.sha;
      }
      checkReviewSendPreconditions(pair, { currentSha, pathExists });
    }
    if (opts.kind !== "freeform") {
      // Dry validation before spending a codex call: throws on a
      // capped kind without a permit or a stale cycle id. The real
      // count happens after the turn succeeds.
      recordCountedSend(claimed, opts.label, opts.kind, {
        cycleId: opts.cycleId,
        snapshotId: opts.snapshotId
      });
    }
    return claimed;
  });

  let events;
  let packet;
  try {
    const harness = pair.harness ?? "codex";
    if (wantPool(opts, harness)) {
      try {
        const pooled = await runPooled(pair.cwd, "pair/send", {
          label: pair.label,
          prompt
        });
        events = {
          threadId: pooled.sessionId ?? pair.threadId,
          lastMessage: pooled.lastMessage,
          errors: []
        };
      } catch (err) {
        if (harness !== "codex" || opts.transport === "pool") throw err;
      }
    }
    if (!events) {
      const stdout = await runCodex(buildSendArgs(pair.threadId, opts), {
        cwd: pair.cwd,
        prompt,
        timeoutSec: opts.timeoutSec
      });
      events = parseEvents(stdout);
    }
    await mutateState((s) => {
      let next = applySendUpdate(
        s, pair.label, pair.threadId, new Date().toISOString()
      );
      if (opts.kind !== "freeform") {
        const counted = recordCountedSend(next, pair.label, opts.kind, {
          cycleId: opts.cycleId,
          snapshotId: opts.snapshotId
        });
        next = counted.state;
        packet = counted.disagreementPacket;
      }
      return next;
    });
  } finally {
    await mutateState((s) =>
      releaseInFlight(s, opts.label, process.pid)
    );
  }
  output({
    label: pair.label,
    threadId: pair.threadId,
    kind: opts.kind,
    lastMessage: events.lastMessage,
    errors: events.errors,
    ...(packet ? { disagreementPacket: packet } : {})
  });
}

main().catch((err) => {
  process.stderr.write(`codex-pair: ${err.message}\n`);
  process.exit(1);
});
