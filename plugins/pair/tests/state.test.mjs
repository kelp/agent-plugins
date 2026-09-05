import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "scripts", "pair.mjs");

let dir;
let stateFile;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "codex-pair-state-"));
  stateFile = path.join(dir, "pairs.json");
});

after(() => rmSync(dir, { recursive: true, force: true }));

function run(args) {
  return execFileSync("node", [cli, ...args], {
    env: { ...process.env, CODEX_PAIR_STATE_FILE: stateFile },
    encoding: "utf8"
  });
}

test("missing state file reads as empty", () => {
  const out = JSON.parse(run(["list"]));
  assert.deepEqual(out.pairs, []);
});

test("corrupt state file is an error, not empty state", () => {
  writeFileSync(stateFile, "not json{");
  assert.throws(() => run(["list"]), /corrupt/i);
});

test("wrong-shape state file is an error", () => {
  writeFileSync(stateFile, '{"pairs": "oops"}');
  assert.throws(() => run(["list"]), /shape|invalid/i);
});

test("saves are atomic: no tmp file left behind", () => {
  writeFileSync(stateFile, JSON.stringify({
    pairs: [{
      label: "x", threadId: "t", cwd: dir,
      createdAt: "2026-07-22T00:00:00Z",
      lastUsedAt: "2026-07-22T00:00:00Z", turns: 1
    }]
  }));
  run(["end", "--label", "x"]);
  const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
  assert.deepEqual(leftovers, []);
  assert.deepEqual(JSON.parse(run(["list"])).pairs, []);
});

test("pair entries missing required fields are an error", () => {
  writeFileSync(stateFile, '{"pairs":[{}]}');
  assert.throws(() => run(["list"]), /shape|invalid/i);
});

// Regression for the lost-update race: each process must re-load
// state under a lock right before saving, not save the snapshot
// it loaded at startup. Without that, concurrent removals of
// distinct labels drop each other's writes.
test("concurrent ends on distinct labels lose no updates", async () => {
  const entry = (label) => ({
    label, threadId: `t-${label}`, cwd: dir,
    createdAt: "2026-07-22T00:00:00Z",
    lastUsedAt: "2026-07-22T00:00:00Z", turns: 1
  });
  const labels = ["c1", "c2", "c3", "c4"];
  writeFileSync(
    stateFile,
    JSON.stringify({ pairs: labels.map(entry) })
  );
  const { spawn } = await import("node:child_process");
  await Promise.all(
    labels.map(
      (label) =>
        new Promise((resolve, reject) => {
          const child = spawn(
            "node", [cli, "end", "--label", label],
            { env: { ...process.env, CODEX_PAIR_STATE_FILE: stateFile } }
          );
          child.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error(`end ${label}: ${code}`))
          );
        })
    )
  );
  assert.deepEqual(JSON.parse(run(["list"])).pairs, []);
});

test("labels are restricted to safe characters", () => {
  mkdirSync(path.join(dir, "sub"), { recursive: true });
  assert.throws(
    () => run(["end", "--label", "bad label; rm -rf /"]),
    /invalid label/i
  );
});
