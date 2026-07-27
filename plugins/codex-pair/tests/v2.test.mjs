import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
  gitCQuote,
  gitCUnquote,
  canonicalOmitted,
  DESIGN_CAP,
  REVIEW_CAP,
  getPair,
  upsertPair
} from "../scripts/lib.mjs";

const AT = "2026-07-23T00:00:00Z";

const base = () =>
  migrateState({
    pairs: [{
      label: "a", threadId: "t-a", cwd: "/repo",
      createdAt: AT, lastUsedAt: AT, turns: 1
    }]
  });

// --- migration ---

test("migrateState: absent or explicit 1 becomes v2 with defaults", () => {
  for (const raw of [
    { pairs: [] },
    { schemaVersion: 1, pairs: [] }
  ]) {
    const s = migrateState(raw);
    assert.equal(s.schemaVersion, 2);
    assert.deepEqual(s.pairs, []);
  }
  const pair = getPair(base(), "a");
  assert.equal(pair.designRounds, 0);
  assert.equal(pair.design, undefined);
  assert.equal(pair.review, undefined);
});

test("migrateState rejects bad versions with named errors", () => {
  assert.throws(() => migrateState({ schemaVersion: "x", pairs: [] }),
    /non-integer/i);
  assert.throws(() => migrateState({ schemaVersion: 0, pairs: [] }),
    /below 1/i);
  assert.throws(() => migrateState({ schemaVersion: 3, pairs: [] }),
    /version 3/);
});

// --- design lifecycle ---

test("register creates draft, resets rounds only initially", () => {
  let s = base();
  s = recordCountedSend(s, "a", "design", {}).state;
  s = registerDesign(s, "a", { path: "d.md", sha256: "h1" });
  let p = getPair(s, "a");
  assert.deepEqual(p.design,
    { path: "d.md", sha256: "h1", revision: 0, status: "draft" });
  assert.equal(p.designRounds, 0, "initial register resets");

  s = recordCountedSend(s, "a", "design", {}).state;
  s = registerDesign(s, "a", { path: "d.md", sha256: "h2" });
  p = getPair(s, "a");
  assert.equal(p.design.sha256, "h2");
  assert.equal(p.designRounds, 1, "update preserves counter");
});

test("agree increments revision; register vs agreed errors", () => {
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  s = agreeDesign(s, "a", "h1");
  const p = getPair(s, "a");
  assert.equal(p.design.status, "agreed");
  assert.equal(p.design.revision, 1);
  assert.throws(
    () => registerDesign(s, "a", { path: "d.md", sha256: "h2" }),
    /design-amend/
  );
});

test("amend clears caps, cycle, and both round counters", () => {
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  s = agreeDesign(s, "a", "h1");
  const started = startReviewCycle(s, "a");
  s = started.state;
  for (let i = 0; i < REVIEW_CAP; i++) {
    s = recordCountedSend(s, "a", "review",
      { cycleId: started.cycleId, snapshotId: `s${i}` }).state;
  }
  assert.equal(getPair(s, "a").capState?.review, "decisionRequired");
  s = amendDesign(s, "a");
  const p = getPair(s, "a");
  assert.equal(p.design.status, "amending");
  assert.equal(p.designRounds, 0);
  assert.equal(p.review?.activeCycleId, undefined);
  assert.equal(p.capState?.review, undefined);
  assert.equal(p.capState?.design, undefined);
});

// --- review cycles ---

test("review-start needs agreed design and no active cycle", () => {
  assert.throws(() => startReviewCycle(base(), "a"), /agreed/i);
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  s = agreeDesign(s, "a", "h1");
  const first = startReviewCycle(s, "a");
  assert.equal(first.cycleId, 1);
  assert.throws(() => startReviewCycle(first.state, "a"), /active/i);
});

test("review rounds count within cycle; complete clears", () => {
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  s = agreeDesign(s, "a", "h1");
  const { state: s1, cycleId } = startReviewCycle(s, "a");
  s = recordCountedSend(s1, "a", "review",
    { cycleId, snapshotId: "s1" }).state;
  s = recordCountedSend(s, "a", "review",
    { cycleId, snapshotId: "s2" }).state;
  assert.equal(getPair(s, "a").review.reviewRounds, 2);
  assert.throws(
    () => recordCountedSend(s, "a", "review",
      { cycleId: 99, snapshotId: "s3" }),
    /cycle/i
  );
  s = completeReviewCycle(s, "a", cycleId, "approved", null, AT);
  const p = getPair(s, "a");
  assert.equal(p.review.activeCycleId, undefined);
  assert.equal(p.review.reviewRounds, 0);
  const next = startReviewCycle(s, "a");
  assert.equal(next.cycleId, 2, "cycle ids are monotonic");
});

// --- caps ---

test("hitting a cap requires decision; override grants one permit", () => {
  let s = base();
  let out;
  for (let i = 0; i < DESIGN_CAP; i++) {
    out = recordCountedSend(s, "a", "design", {});
    s = out.state;
  }
  assert.equal(getPair(s, "a").capState.design, "decisionRequired");
  assert.ok(out.disagreementPacket, "packet skeleton emitted at cap");
  assert.throws(() => recordCountedSend(s, "a", "design", {}),
    /override-cap/);

  s = overrideCap(s, "a", "design", "user said continue", AT);
  assert.equal(getPair(s, "a").capOverrides.length, 1);
  s = recordCountedSend(s, "a", "design", {}).state;
  assert.throws(() => recordCountedSend(s, "a", "design", {}),
    /override-cap/, "permit is single-use");
});

// --- review send preconditions ---

test("review preconditions name the specific violation", () => {
  const agreed = { path: "d.md", sha256: "h1", revision: 1,
    status: "agreed" };
  assert.throws(
    () => checkReviewSendPreconditions({ design: undefined }, {}),
    /no agreed design.*design-amend|design-register/i
  );
  assert.throws(
    () => checkReviewSendPreconditions(
      { design: agreed }, { currentSha: "h2", pathExists: true }),
    /hash.*design-amend/i
  );
  assert.throws(
    () => checkReviewSendPreconditions(
      { design: agreed }, { currentSha: "h1", pathExists: false }),
    /path.*design-amend/i
  );
  assert.throws(
    () => checkReviewSendPreconditions(
      { design: agreed }, { currentSha: null, pathExists: false }),
    /path.*design-amend/i,
    "an unlinked file is a path violation, not a hash change"
  );
  checkReviewSendPreconditions(
    { design: agreed }, { currentSha: "h1", pathExists: true });
});

// --- snapshot assembly ---

const piece = (path, text) => ({
  path, text, bytes: Buffer.byteLength(text ?? "", "utf8"),
  binary: text === null
});

test("assembleSnapshot orders, caps, and marks binary", () => {
  const pieces = [
    piece("b.txt", "diff --git b.txt\n+b\n"),
    piece("a.txt", "diff --git a.txt\n+a\n"),
    piece("img.png", null)
  ];
  pieces[2].bytes = 9;
  const r = assembleSnapshot(pieces, { capBytes: 10_000 });
  assert.ok(r.patch.indexOf("a.txt") < r.patch.indexOf("b.txt"),
    "bytewise path order");
  assert.match(r.patch, /Binary file img\.png differs \(9 bytes\)/);
  assert.deepEqual(r.omitted, []);
  assert.equal(r.warning, null);
});

test("assembleSnapshot omits overflow deterministically", () => {
  const big = piece("big.txt", "x".repeat(300));
  const small = piece("a.txt", "diff a\n");
  const r = assembleSnapshot([big, small], { capBytes: 50 });
  assert.match(r.patch, /diff a/);
  assert.equal(r.omitted.length, 1);
  assert.equal(r.omitted[0].path, "big.txt");
  assert.equal(r.omitted[0].reason, "size");
  assert.match(r.warning, /omitted/i);
});

test("assembleSnapshot uses no aggregate when omissions fit exactly", () => {
  const pieces = [];
  for (let i = 0; i < 100; i++) {
    pieces.push(piece(`g${String(i).padStart(3, "0")}.txt`, "z".repeat(50)));
  }
  const r = assembleSnapshot(pieces, { capBytes: 1, omitEntries: 100 });
  assert.equal(r.omitted.length, 100);
  assert.ok(!r.omitted.some((e) => e.aggregate),
    "no aggregate when all omissions fit the limits");
});

test("assembleSnapshot omits oversized pieces without content", () => {
  const huge = { path: "huge.bin", text: "", bytes: 999, binary: false,
    forceOmit: true };
  const small = piece("a.txt", "diff a\n");
  const r = assembleSnapshot([huge, small], { capBytes: 10_000 });
  assert.match(r.patch, /diff a/);
  assert.ok(!r.patch.includes("huge.bin"));
  assert.equal(r.omitted[0].path, "huge.bin");
  assert.equal(r.omitted[0].bytes, 999);
});

// After the first omitted path, every later path must also be
// omitted: the patch is always a bytewise-ordered prefix.
test("a forced omission omits every later path too", () => {
  const first = { path: "a.big", text: "", bytes: 500, binary: false,
    forceOmit: true };
  const later = piece("b.txt", "diff b\n");
  const r = assembleSnapshot([first, later], { capBytes: 10_000 });
  assert.equal(r.patch, "");
  assert.deepEqual(r.omitted.map((e) => e.path), ["a.big", "b.txt"]);
});

test("assembleSnapshot sorts by raw sort key when present", () => {
  const a = { ...piece("\"b-display\"", "diff raw-a\n"), sortKey: "a" };
  const b = { ...piece("a-display", "diff raw-b\n"), sortKey: "b" };
  const r = assembleSnapshot([b, a], { capBytes: 10_000 });
  assert.ok(r.patch.indexOf("raw-a") < r.patch.indexOf("raw-b"),
    "raw bytes order, not display order");
});

test("gitCUnquote inverts gitCQuote byte-exactly", () => {
  const cases = [
    Buffer.from("plain.txt"),
    Buffer.from('quo"te'),
    Buffer.from("back\\slash"),
    Buffer.from("tab\tname"),
    Buffer.from([0x66, 0x01]),
    Buffer.from([0x66, 0xc3, 0xa9])
  ];
  for (const raw of cases) {
    assert.deepEqual(gitCUnquote(gitCQuote(raw)), raw);
  }
});

test("canonicalOmitted orders by raw path bytes, not display", () => {
  // Display string for the e-acute name starts with a quote (0x22)
  // and would sort before z.txt; its raw bytes (0xc3...) sort after.
  const eacute = { path: gitCQuote(Buffer.from([0xc3, 0xa9, 0x2e])),
    bytes: 1, reason: "size" };
  const z = { path: "z.txt", bytes: 2, reason: "size" };
  const serial = canonicalOmitted([eacute, z]);
  assert.ok(serial.indexOf("z.txt") < serial.indexOf("303"),
    "raw byte order puts z.txt first");
});

test("gitCQuote matches canonical Git C-style quoting", () => {
  assert.equal(gitCQuote(Buffer.from("plain.txt")), "plain.txt");
  assert.equal(gitCQuote(Buffer.from("sp ace.txt")), "sp ace.txt");
  assert.equal(gitCQuote(Buffer.from('quo"te')), '"quo\\"te"');
  assert.equal(gitCQuote(Buffer.from("back\\slash")),
    '"back\\\\slash"');
  assert.equal(gitCQuote(Buffer.from("tab\tname")), '"tab\\tname"');
  assert.equal(gitCQuote(Buffer.from("nl\nname")), '"nl\\nname"');
  assert.equal(gitCQuote(Buffer.from([0x66, 0x01])), '"f\\001"');
  assert.equal(gitCQuote(Buffer.from([0x66, 0xc3, 0xa9])),
    '"f\\303\\251"', "non-ASCII bytes become octal escapes");
});

test("assembleSnapshot bounds omitted with a final aggregate entry", () => {
  const pieces = [];
  for (let i = 0; i < 150; i++) {
    pieces.push(piece(`f${String(i).padStart(3, "0")}.txt`,
      "z".repeat(200)));
  }
  const r = assembleSnapshot(pieces, { capBytes: 10, omitEntries: 100 });
  assert.ok(r.omitted.length <= 100);
  const last = r.omitted[r.omitted.length - 1];
  assert.ok(last.aggregate, "aggregate is the final omitted entry");
  assert.ok(last.aggregate.omittedFiles >= 50);
  assert.ok(last.aggregate.omittedBytes > 0);
  assert.equal(r.aggregate, undefined, "no top-level aggregate field");
  const r2 = assembleSnapshot(pieces.slice(0, 120),
    { capBytes: 10, omitEntries: 100 });
  assert.notEqual(
    snapshotIdFor(r.patch, r.omitted),
    snapshotIdFor(r2.patch, r2.omitted),
    "different omitted tails must not collide"
  );
});

test("agreeDesign rejects an already agreed design", () => {
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  s = agreeDesign(s, "a", "h1");
  assert.throws(() => agreeDesign(s, "a", "h2"), /design-amend/);
});

test("overrideCap requires an active decisionRequired cap", () => {
  assert.throws(
    () => overrideCap(base(), "a", "design", "go", AT),
    /decision|cap/i
  );
});

test("clearing a cap clears stale permits", () => {
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  for (let i = 0; i < DESIGN_CAP; i++) {
    s = recordCountedSend(s, "a", "design", {}).state;
  }
  s = overrideCap(s, "a", "design", "go", AT);
  s = amendDesign(s, "a");
  for (let i = 0; i < DESIGN_CAP; i++) {
    s = recordCountedSend(s, "a", "design", {}).state;
  }
  assert.throws(() => recordCountedSend(s, "a", "design", {}),
    /override-cap/, "stale permit must not bypass a fresh cap");
});

test("review snapshot records are cycle-scoped", () => {
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  s = agreeDesign(s, "a", "h1");
  const c1 = startReviewCycle(s, "a");
  s = recordCountedSend(c1.state, "a", "review",
    { cycleId: c1.cycleId, snapshotId: "s1" }).state;
  s = completeReviewCycle(s, "a", c1.cycleId, "approved", null, AT);
  const c2 = startReviewCycle(s, "a");
  s = recordCountedSend(c2.state, "a", "review",
    { cycleId: c2.cycleId, snapshotId: "s2" }).state;
  assert.deepEqual(getPair(s, "a").review.roundSnapshots, [
    { cycleId: 1, snapshotId: "s1" },
    { cycleId: 2, snapshotId: "s2" }
  ]);
});

test("snapshotIdFor is stable and order-insensitive input-canonical", () => {
  const omitted = [
    { path: "b", bytes: 2, reason: "size" },
    { path: "a", bytes: 1, reason: "size" }
  ];
  const id1 = snapshotIdFor("patch", omitted);
  const id2 = snapshotIdFor("patch", [...omitted].reverse());
  assert.equal(id1, id2, "canonical serialization sorts entries");
  assert.match(id1, /^[0-9a-f]{64}$/);
  assert.notEqual(id1, snapshotIdFor("patch2", omitted));
});

// --- upsert survives v2 fields ---

test("upsertPair round-trips v2 fields", () => {
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  const p = getPair(s, "a");
  s = upsertPair(s, { ...p, turns: 9 });
  assert.equal(getPair(s, "a").design.sha256, "h1");
});

// --- judge rulings (advisory third opinion) ---

test("recordJudgeRuling appends an audit entry with rounds and verdict", () => {
  let s = base();
  assert.deepEqual(getPair(s, "a").judgeRulings, [],
    "migration defaults the ruling log to empty");
  for (let i = 0; i < 2; i++) {
    s = recordCountedSend(s, "a", "design", {}).state;
  }
  s = recordJudgeRuling(s, "a", "design",
    { verdict: "codex", ruling: "codex is right about the retry window" },
    AT);
  const rulings = getPair(s, "a").judgeRulings;
  assert.equal(rulings.length, 1);
  assert.deepEqual(rulings[0], {
    at: AT, kind: "design", rounds: 2, verdict: "codex",
    ruling: "codex is right about the retry window"
  });
});

test("recordJudgeRuling stamps the active cycle for review kind", () => {
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  s = agreeDesign(s, "a", "h1");
  const c = startReviewCycle(s, "a");
  s = recordCountedSend(c.state, "a", "review",
    { cycleId: c.cycleId, snapshotId: "s1" }).state;
  s = recordJudgeRuling(s, "a", "review",
    { verdict: "split", ruling: "point 1 stands, point 2 does not" }, AT);
  const r = getPair(s, "a").judgeRulings[0];
  assert.equal(r.cycleId, c.cycleId);
  assert.equal(r.rounds, 1);
});

test("recordJudgeRuling rejects bad kind, bad verdict, empty ruling", () => {
  const s = base();
  assert.throws(
    () => recordJudgeRuling(s, "a", "freeform",
      { verdict: "claude", ruling: "x" }, AT), /kind/i);
  assert.throws(
    () => recordJudgeRuling(s, "a", "design",
      { verdict: "maybe", ruling: "x" }, AT), /verdict/i);
  assert.throws(
    () => recordJudgeRuling(s, "a", "design",
      { verdict: "claude", ruling: "  " }, AT), /ruling/i);
});

test("a judge ruling is advisory: no permit, no cap change", () => {
  let s = base();
  for (let i = 0; i < DESIGN_CAP; i++) {
    s = recordCountedSend(s, "a", "design", {}).state;
  }
  s = recordJudgeRuling(s, "a", "design",
    { verdict: "claude", ruling: "claude's position holds" }, AT);
  assert.equal(getPair(s, "a").capState.design, "decisionRequired");
  assert.throws(() => recordCountedSend(s, "a", "design", {}),
    /override-cap/, "only the user's override grants a round");
});

test("judge rulings survive design-amend as an audit trail", () => {
  let s = registerDesign(base(), "a", { path: "d.md", sha256: "h1" });
  s = recordJudgeRuling(s, "a", "design",
    { verdict: "codex", ruling: "codex wins round one" }, AT);
  s = amendDesign(s, "a");
  assert.equal(getPair(s, "a").judgeRulings.length, 1);
});
