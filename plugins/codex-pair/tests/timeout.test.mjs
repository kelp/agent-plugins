import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "scripts", "codex-pair.mjs");

// codex is a Node launcher that spawns the native binary, so the
// wrapper must terminate the whole process group on timeout. A
// grandchild that keeps ticking after the CLI exits would keep
// appending to the thread's rollout file in real life.
const LAUNCHER_FAKE = `#!/bin/sh
( while :; do echo tick >> "$FAKE_TICKS"; sleep 0.1; done ) &
cat > /dev/null
sleep 600
`;

let dir;
let stateFile;
let env;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "codex-pair-timeout-"));
  stateFile = path.join(dir, "pairs.json");
  const fake = path.join(dir, "codex");
  writeFileSync(fake, LAUNCHER_FAKE);
  chmodSync(fake, 0o755);
  writeFileSync(stateFile, JSON.stringify({
    pairs: [{
      label: "a", threadId: "t-a", cwd: dir,
      createdAt: "2026-07-22T00:00:00Z",
      lastUsedAt: "2026-07-22T00:00:00Z", turns: 1
    }]
  }));
  env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    CODEX_PAIR_STATE_FILE: stateFile,
    FAKE_TICKS: path.join(dir, "ticks.txt")
  };
});

after(() => rmSync(dir, { recursive: true, force: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A child may trap SIGTERM and exit 0; external cancellation must
// still be reported as failure and must not update turn counts.
const TRAPPING_FAKE = `#!/bin/sh
trap 'exit 0' TERM
cat > /dev/null
sleep 600
`;

test("external SIGTERM rejects even if child exits 0", async () => {
  const fake = path.join(dir, "codex");
  writeFileSync(fake, TRAPPING_FAKE);
  chmodSync(fake, 0o755);

  const result = await new Promise((resolve) => {
    const child = spawn(
      "node", [cli, "send", "--label", "a", "--kind", "freeform", "--timeout-sec", "60"],
      { env }
    );
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    child.stdin.end("hello");
    setTimeout(() => child.kill("SIGTERM"), 500);
    child.on("close", (code) => resolve({ code, stderr }));
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /terminat/i);

  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.pairs[0].turns, 1, "cancelled turn was recorded");
  assert.equal(state.pairs[0].inFlight, undefined);
});

test("timeout kills the whole process tree, then releases", async () => {
  const fake = path.join(dir, "codex");
  writeFileSync(fake, LAUNCHER_FAKE);
  chmodSync(fake, 0o755);
  const result = await new Promise((resolve) => {
    const child = spawn(
      "node", [cli, "send", "--label", "a", "--kind", "freeform", "--timeout-sec", "1"],
      { env }
    );
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    child.stdin.end("hello");
    child.on("close", (code) => resolve({ code, stderr }));
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /timed out/i);

  // The grandchild must be dead: no new ticks after the CLI exits.
  const s1 = readFileSync(env.FAKE_TICKS, "utf8").length;
  await sleep(400);
  const s2 = readFileSync(env.FAKE_TICKS, "utf8").length;
  assert.equal(s1, s2, "grandchild still ticking after CLI exit");

  // Token released only after the tree died.
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.pairs[0].inFlight, undefined);
});
