import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, mkdirSync,
  readdirSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "scripts", "codex-pair.mjs");

let dir; // state + fake codex
let repo; // real git repo for snapshot
let env;

const FAKE = `#!/bin/sh
cat > /dev/null
cat <<'EOF'
{"type":"thread.started","thread_id":"t-v2"}
{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"ok"}}
EOF
`;

function git(...args) {
  return execFileSync("git",
    ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
    { cwd: repo, encoding: "utf8" });
}

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "codex-pair-v2cli-"));
  repo = path.join(dir, "repo");
  mkdirSync(repo);
  const fake = path.join(dir, "codex");
  writeFileSync(fake, FAKE);
  chmodSync(fake, 0o755);
  env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    CODEX_PAIR_STATE_FILE: path.join(dir, "pairs.json")
  };
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(path.join(repo, "tracked.txt"), "one\n");
  git("add", "tracked.txt");
  git("commit", "-qm", "init");
});

after(() => rmSync(dir, { recursive: true, force: true }));

function run(args, input = "") {
  return execFileSync("node", [cli, ...args], { env, input, encoding: "utf8" });
}

test("v1 state migrates to v2 on load and persists on save", () => {
  writeFileSync(env.CODEX_PAIR_STATE_FILE, JSON.stringify({
    pairs: [{
      label: "p", threadId: "t-v2", cwd: repo,
      createdAt: "2026-07-23T00:00:00Z",
      lastUsedAt: "2026-07-23T00:00:00Z", turns: 1
    }]
  }));
  const out = JSON.parse(run(["list"]));
  assert.equal(out.schemaVersion, 2);
  run(["send", "--label", "p", "--kind", "freeform"], "hi");
  const disk = JSON.parse(readFileSync(env.CODEX_PAIR_STATE_FILE, "utf8"));
  assert.equal(disk.schemaVersion, 2);
});

test("send requires --kind", () => {
  assert.throws(() => run(["send", "--label", "p"], "hi"), /--kind/);
});

test("design lifecycle over the CLI", () => {
  mkdirSync(path.join(repo, ".codex-pair"), { recursive: true });
  const dpath = ".codex-pair/design-p.md";
  writeFileSync(path.join(repo, dpath), "v1 design\n");
  assert.throws(
    () => run(["design-register", "--label", "p", "--path", "wrong.md"]),
    /\.codex-pair/
  );
  run(["design-register", "--label", "p", "--path", dpath]);
  let state = JSON.parse(run(["list"]));
  assert.equal(state.pairs[0].design.status, "draft");

  run(["design-agree", "--label", "p"]);
  state = JSON.parse(run(["list"]));
  assert.equal(state.pairs[0].design.status, "agreed");
  assert.equal(state.pairs[0].design.revision, 1);

  // review send with stale hash must fail naming design-amend
  writeFileSync(path.join(repo, dpath), "v2 design drifted\n");
  const started = JSON.parse(run(["review-start", "--label", "p"]));
  assert.equal(started.cycleId, 1);
  assert.throws(
    () => run(["send", "--label", "p", "--kind", "review",
      "--cycle-id", "1", "--snapshot-id", "s1"], "review this"),
    /design-amend/
  );

  run(["design-amend", "--label", "p"]);
  state = JSON.parse(run(["list"]));
  assert.equal(state.pairs[0].design.status, "amending");
});

test("design-register rejects paths outside the repo", () => {
  assert.throws(
    () => run(["design-register", "--label", "p", "--path",
      "../.codex-pair/design-p.md"]),
    /inside|outside|not found|must live at/i
  );
});

test("snapshot emits deterministic envelope", () => {
  writeFileSync(path.join(repo, "tracked.txt"), "one\ntwo\n");
  writeFileSync(path.join(repo, "new.txt"), "brand new\n");
  writeFileSync(path.join(repo, "sp ace.txt"), "spaced content\n");
  writeFileSync(path.join(repo, "bin.dat"),
    Buffer.from([0, 1, 2, 255, 0, 7]));

  const a = JSON.parse(run(["snapshot", "--label", "p"]));
  const b = JSON.parse(run(["snapshot", "--label", "p"]));
  assert.equal(a.snapshotId, b.snapshotId, "byte-identical reruns");
  assert.match(a.snapshotId, /^[0-9a-f]{64}$/);
  assert.match(a.patch, /tracked\.txt/);
  assert.match(a.patch, /brand new/);
  assert.match(a.patch, /spaced content/);
  assert.match(a.patch, /Binary file bin\.dat differs \(6 bytes\)/);
  assert.ok(
    a.patch.indexOf("bin.dat") < a.patch.indexOf("new.txt"),
    "bytewise path order across tracked and untracked"
  );
  assert.deepEqual(a.omitted, []);
  assert.equal(a.warning, null);
  // index untouched
  const staged = git("diff", "--cached", "--name-only");
  assert.equal(staged.trim(), "");
});

test("override-cap flow over the CLI", () => {
  for (let i = 0; i < 5; i++) {
    run(["send", "--label", "p", "--kind", "design"], `round ${i}`);
  }
  const state = JSON.parse(run(["list"]));
  assert.equal(state.pairs[0].capState.design, "decisionRequired");
  assert.throws(
    () => run(["send", "--label", "p", "--kind", "design"], "more"),
    /override-cap/
  );
  run(["override-cap", "--label", "p", "--kind", "design"],
    "user chose to continue");
  run(["send", "--label", "p", "--kind", "design"], "one more");
  const after1 = JSON.parse(run(["list"]));
  assert.equal(after1.pairs[0].capOverrides.length, 1);
});

test("review-complete user-decided rejects empty decision", () => {
  assert.throws(
    () => run(["review-complete", "--label", "p", "--cycle-id", "1",
      "--outcome", "user-decided"], ""),
    /decision/i
  );
});

test("first run persists schemaVersion 2", () => {
  const alt = path.join(dir, "fresh-state.json");
  execFileSync("node", [cli, "start", "--label", "fresh", "--cwd", repo], {
    env: { ...env, CODEX_PAIR_STATE_FILE: alt },
    input: "hello",
    encoding: "utf8"
  });
  const disk = JSON.parse(readFileSync(alt, "utf8"));
  assert.equal(disk.schemaVersion, 2);
});

test("lifecycle commands refuse while a send is in flight", () => {
  const s = JSON.parse(readFileSync(env.CODEX_PAIR_STATE_FILE, "utf8"));
  const p = s.pairs.find((x) => x.label === "p");
  p.inFlight = { pid: 999999, expiresAt: "2999-01-01T00:00:00Z" };
  writeFileSync(env.CODEX_PAIR_STATE_FILE, JSON.stringify(s));
  assert.throws(() => run(["design-amend", "--label", "p"]), /in flight/i);
  assert.throws(() => run(["review-start", "--label", "p"]), /in flight/i);
  delete p.inFlight;
  writeFileSync(env.CODEX_PAIR_STATE_FILE, JSON.stringify(s));
});

test("deleting the agreed design file blocks review sends as a path violation", () => {
  const alt = path.join(dir, "del-state.json");
  const e2 = { ...env, CODEX_PAIR_STATE_FILE: alt };
  const r2 = (args, input = "") =>
    execFileSync("node", [cli, ...args], { env: e2, input, encoding: "utf8" });
  r2(["start", "--label", "d1", "--cwd", repo], "hi");
  const dp = ".codex-pair/design-d1.md";
  writeFileSync(path.join(repo, dp), "design\n");
  r2(["design-register", "--label", "d1", "--path", dp]);
  r2(["design-agree", "--label", "d1"]);
  const started = JSON.parse(r2(["review-start", "--label", "d1"]));
  rmSync(path.join(repo, dp));
  assert.throws(
    () => r2(["send", "--label", "d1", "--kind", "review",
      "--cycle-id", String(started.cycleId), "--snapshot-id", "x"], "go"),
    /path.*design-amend/i
  );
});

test("snapshot omits huge files with exact diff byte counts", () => {
  writeFileSync(path.join(repo, "huge.txt"), "x".repeat(40 * 1024 * 1024));
  const s = JSON.parse(run(["snapshot", "--label", "p"]));
  const entry = s.omitted.find((e) => e.path === "huge.txt");
  assert.ok(entry, "huge file omitted");
  assert.ok(entry.bytes >= 40 * 1024 * 1024,
    "bytes reflect the actual diff size, not a guess");
  assert.ok(!s.patch.includes("x".repeat(1000)));
  rmSync(path.join(repo, "huge.txt"));
});

test("valid non-ASCII paths get canonical quoting end to end", () => {
  const name = "caf\u00e9.txt";
  writeFileSync(path.join(repo, name), "au lait\n");
  const s = JSON.parse(run(["snapshot", "--label", "p"]));
  assert.match(s.patch, /au lait/, "content included");
  assert.match(s.patch, /caf\\303\\251\.txt/,
    "diff headers carry Git's canonical quoted form");
  rmSync(path.join(repo, name));
});

test("snapshot cleans up its spool directory even on rerun", () => {
  const spoolDir = process.env.TMPDIR ?? tmpdir();
  const count = () =>
    readdirSync(spoolDir)
      .filter((n) => n.startsWith("codex-pair-snap-")).length;
  const before = count();
  run(["snapshot", "--label", "p"]);
  run(["snapshot", "--label", "p"]);
  assert.equal(count(), before, "no spool directories left behind");
});

test("snapshot output ignores the user's core.quotePath setting", () => {
  const name = "caf\u00e9.txt";
  writeFileSync(path.join(repo, name), "au lait\n");
  const a = JSON.parse(run(["snapshot", "--label", "p"]));
  const b = JSON.parse(
    execFileSync("node", [cli, "snapshot", "--label", "p"], {
      env: { ...env, GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.quotePath",
        GIT_CONFIG_VALUE_0: "false" },
      encoding: "utf8"
    })
  );
  assert.equal(a.snapshotId, b.snapshotId,
    "user-level quotePath must not change the snapshot");
  assert.match(a.patch, /caf\\303\\251\.txt/);
  rmSync(path.join(repo, name));
});

test("mixed non-ASCII plus escaped characters canonicalize fully", () => {
  const name = 'caf\u00e9".txt';
  writeFileSync(path.join(repo, name), "mixed\n");
  const s = JSON.parse(run(["snapshot", "--label", "p"]));
  assert.match(s.patch, /mixed/);
  assert.ok(
    s.patch.includes('"b/caf\\303\\251\\".txt"'),
    "header carries the fully canonical quoted form"
  );
  rmSync(path.join(repo, name));
});
