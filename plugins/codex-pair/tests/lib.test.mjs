import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCliArgs,
  parseEvents,
  getPair,
  upsertPair,
  removePair,
  applySendUpdate,
  buildStartArgs,
  buildSendArgs,
  renderEventLine
} from "../scripts/lib.mjs";

// --- parseCliArgs ---

test("parseCliArgs applies defaults for start", () => {
  const opts = parseCliArgs(["start"]);
  assert.equal(opts.command, "start");
  assert.equal(opts.label, "default");
  assert.equal(opts.harness, "codex");
  assert.equal(opts.sandbox, "read-only");
  assert.equal(opts.model, null);
  assert.equal(opts.cwd, null);
  assert.equal(opts.timeoutSec, 600);
});

test("parseCliArgs reads flags", () => {
  const opts = parseCliArgs([
    "start", "--label", "auth", "--harness", "grok", "--cwd", "/repo",
    "--model", "gpt-5.5-codex", "--sandbox", "workspace-write",
    "--timeout-sec", "120"
  ]);
  assert.equal(opts.label, "auth");
  assert.equal(opts.harness, "grok");
  assert.equal(opts.cwd, "/repo");
  assert.equal(opts.model, "gpt-5.5-codex");
  assert.equal(opts.sandbox, "workspace-write");
  assert.equal(opts.timeoutSec, 120);
});

test("parseCliArgs rejects unknown command and flags", () => {
  assert.throws(() => parseCliArgs(["dance"]), /unknown command/i);
  assert.throws(() => parseCliArgs(["start", "--bogus"]), /unknown flag/i);
  assert.throws(() => parseCliArgs([]), /usage/i);
});

test("parseCliArgs rejects invalid sandbox", () => {
  assert.throws(
    () => parseCliArgs(["start", "--sandbox", "danger-full-access"]),
    /sandbox/i
  );
});

// --- parseEvents ---

const JSONL = [
  '{"type":"thread.started","thread_id":"t-123"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"first"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"final answer"}}',
  '{"type":"turn.completed","usage":{"input_tokens":1}}'
].join("\n");

test("parseEvents extracts thread id and last agent message", () => {
  const r = parseEvents(JSONL);
  assert.equal(r.threadId, "t-123");
  assert.equal(r.lastMessage, "final answer");
  assert.deepEqual(r.errors, []);
});

test("parseEvents handles empty and non-JSON lines", () => {
  const r = parseEvents("\nnot json\n");
  assert.equal(r.threadId, null);
  assert.equal(r.lastMessage, null);
});

test("parseEvents collects error events", () => {
  const r = parseEvents('{"type":"error","message":"rate limited"}');
  assert.deepEqual(r.errors, ["rate limited"]);
});

// --- state ops ---

const pair = (label) => ({
  label,
  threadId: `thread-${label}`,
  cwd: "/repo",
  createdAt: "2026-07-22T00:00:00Z",
  lastUsedAt: "2026-07-22T00:00:00Z",
  turns: 1
});

test("upsertPair adds and getPair finds", () => {
  const s1 = upsertPair({ pairs: [] }, pair("a"));
  assert.equal(getPair(s1, "a").threadId, "thread-a");
  assert.equal(getPair(s1, "missing"), undefined);
});

test("upsertPair replaces same label without duplicating", () => {
  const s1 = upsertPair({ pairs: [] }, pair("a"));
  const s2 = upsertPair(s1, { ...pair("a"), turns: 5 });
  assert.equal(s2.pairs.length, 1);
  assert.equal(getPair(s2, "a").turns, 5);
});

test("removePair removes, throws on missing", () => {
  const s1 = upsertPair({ pairs: [] }, pair("a"));
  const s2 = removePair(s1, "a");
  assert.equal(s2.pairs.length, 0);
  assert.throws(() => removePair(s2, "a"), /no pair/i);
});

// send's final state update must be keyed on (label, threadId),
// not label alone: if the pair was ended and the label reused by
// a new thread mid-flight, the update must not touch the new pair.
test("applySendUpdate updates only the thread it talked to", () => {
  const s = upsertPair({ pairs: [] }, pair("a"));
  const hit = applySendUpdate(s, "a", "thread-a", "2026-07-23T00:00:00Z");
  assert.equal(getPair(hit, "a").turns, 2);
  assert.equal(getPair(hit, "a").lastUsedAt, "2026-07-23T00:00:00Z");

  const reused = applySendUpdate(s, "a", "other-thread", "t");
  assert.equal(getPair(reused, "a").turns, 1);

  const gone = applySendUpdate({ pairs: [] }, "a", "thread-a", "t");
  assert.deepEqual(gone.pairs, []);
});

// --- progress rendering ---

test("renderEventLine renders compact progress lines", () => {
  assert.equal(
    renderEventLine({ type: "thread.started", thread_id: "t-1" }),
    "thread t-1"
  );
  assert.equal(
    renderEventLine({
      type: "item.completed",
      item: { type: "command_execution", command: "node --test tests/" }
    }),
    "command_execution: node --test tests/"
  );
  const long = renderEventLine({
    type: "item.completed",
    item: { type: "agent_message", text: "x".repeat(200) }
  });
  assert.ok(long.length <= 100);
  assert.equal(
    renderEventLine({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 5 }
    }),
    "turn done (in 10, out 5 tokens)"
  );
  assert.equal(renderEventLine({ type: "some.unknown" }), null);
});

// Event fields are untrusted model/tool output headed for a
// terminal: control sequences must be stripped, newlines
// collapsed, and every rendered line capped, in every branch.
test("renderEventLine sanitizes untrusted event text", () => {
  const ctl = /[\x00-\x1f\x7f-\x9f]/;

  const esc = renderEventLine({
    type: "turn.failed",
    error: { message: "bad\x1b]0;pwned\x07\x1b[2Jthing" }
  });
  assert.ok(!ctl.test(esc), "control chars leak");
  assert.match(esc, /bad.*thing/);

  const multi = renderEventLine({
    type: "turn.failed",
    error: { message: "line1\nline2\r\nline3" }
  });
  assert.ok(!multi.includes("\n"));
  assert.match(multi, /line1 line2 line3/);

  const huge = renderEventLine({
    type: "turn.failed",
    error: { message: "y".repeat(500) }
  });
  assert.ok(huge.length <= 100);

  const evilThread = renderEventLine({
    type: "thread.started",
    thread_id: "t\x1b[31m-1"
  });
  assert.ok(!ctl.test(evilThread));
});

// --- codex argv construction ---

test("buildStartArgs uses exec with sandbox and stdin prompt", () => {
  const args = buildStartArgs({ sandbox: "read-only", model: null });
  assert.deepEqual(args, [
    "exec", "--json", "--skip-git-repo-check",
    "-s", "read-only", "-"
  ]);
});

test("buildStartArgs includes model when set", () => {
  const args = buildStartArgs({ sandbox: "read-only", model: "gpt-x" });
  assert.ok(args.includes("-m"));
  assert.ok(args.includes("gpt-x"));
});

// codex 0.145: `exec resume` accepts no -s or -C flags; sandbox and
// cwd come from the recorded session. Passing -s breaks the call.
test("buildSendArgs resumes by id and never passes -s or -C", () => {
  const args = buildSendArgs("t-123", { model: null });
  assert.deepEqual(args, [
    "exec", "resume", "t-123", "--json", "--skip-git-repo-check", "-"
  ]);
  assert.ok(!args.includes("-s"));
  assert.ok(!args.includes("-C"));
});

test("buildSendArgs includes model when set", () => {
  const args = buildSendArgs("t-123", { model: "gpt-x" });
  assert.ok(args.includes("-m"));
  assert.ok(args.includes("gpt-x"));
});
