import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "scripts", "harness.mjs");
const fakes = path.join(here, "fakes");

let dir;
let env;

function binWrap(name, script) {
  const dest = path.join(dir, "bin", name);
  writeFileSync(
    dest,
    `#!/bin/sh\nexec node "${script}" "$@"\n`
  );
  chmodSync(dest, 0o755);
}

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "harness-cli-"));
  mkdirSync(path.join(dir, "bin"));
  binWrap("codex", path.join(fakes, "codex.mjs"));
  binWrap("grok", path.join(fakes, "grok.mjs"));
  binWrap("claude", path.join(fakes, "claude.mjs"));
  const stateFile = path.join(dir, "fake-state.json");
  writeFileSync(stateFile, "{}\n");
  env = {
    ...process.env,
    PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
    HARNESS_FAKE_STATE: stateFile,
    HARNESS_POOL_DIR: path.join(dir, "pool"),
    HARNESS_IDLE_MS: "60000"
  };
});

after(() => {
  try {
    execFileSync("node", [cli, "pool", "stop"], { env, encoding: "utf8" });
  } catch {
    // broker may already be down
  }
  rmSync(dir, { recursive: true, force: true });
});

function run(args, input = "") {
  return execFileSync("node", [cli, ...args], {
    env,
    input,
    encoding: "utf8",
    timeout: 15000
  });
}

function fakeState() {
  return JSON.parse(readFileSync(env.HARNESS_FAKE_STATE, "utf8"));
}

test("review grok returns parsed native findings", () => {
  const out = JSON.parse(
    run(["review", "--callees", "grok", "--cwd", dir, "--target", "working-tree"])
  );
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].harness, "grok");
  assert.equal(out.results[0].ok, true);
  assert.equal(out.results[0].findings[0].file, "src/x.rs");
  assert.equal(out.results[0].findings[0].severity, "high");
});

test("second grok review reuses the warm agent process", () => {
  const beforeStarts = fakeState().grokStarts;
  run(["review", "--callees", "grok", "--cwd", dir, "--target", "working-tree"]);
  assert.equal(fakeState().grokStarts, beforeStarts);
});

test("review can run grok and codex in one call", () => {
  const out = JSON.parse(
    run(["review", "--callees", "grok,codex", "--cwd", dir])
  );
  const names = out.results.map((r) => r.harness).sort();
  assert.deepEqual(names, ["codex", "grok"]);
  assert.ok(out.results.every((r) => r.ok && r.findings.length >= 1));
});

test("pair start and send reuse the same grok session process", () => {
  const starts = fakeState().grokStarts;
  const started = JSON.parse(
    run(["pair", "start", "--harness", "grok", "--label", "t", "--cwd", dir], "hello partner")
  );
  assert.match(started.lastMessage, /grok pair/);
  const sent = JSON.parse(
    run(["pair", "send", "--label", "t"], "next turn")
  );
  assert.match(sent.lastMessage, /next turn/);
  assert.equal(fakeState().grokStarts, starts);
});

test("pool status lists warm slots", () => {
  const out = JSON.parse(run(["pool", "status", "--cwd", dir]));
  assert.ok(out.slots.length >= 1);
});
