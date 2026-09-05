import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "scripts", "pair.mjs");

let dir;
let env;

const FAKE_CODEX = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_ARGS"
cat > "$FAKE_STDIN"
cat <<'EOF'
{"type":"thread.started","thread_id":"fake-thread-1"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello from codex"}}
{"type":"turn.completed","usage":{}}
EOF
`;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "codex-pair-test-"));
  const fake = path.join(dir, "codex");
  writeFileSync(fake, FAKE_CODEX);
  chmodSync(fake, 0o755);
  env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    HARNESS_PAIR_TRANSPORT: "exec",
    CODEX_PAIR_STATE_FILE: path.join(dir, "state", "pairs.json"),
    FAKE_ARGS: path.join(dir, "args.txt"),
    FAKE_STDIN: path.join(dir, "stdin.txt")
  };
});

after(() => rmSync(dir, { recursive: true, force: true }));

function run(args, input = "") {
  return execFileSync("node", [cli, ...args], {
    env,
    input,
    encoding: "utf8"
  });
}

test("start creates a pair and stores the thread id", () => {
  const out = JSON.parse(
    run(["start", "--label", "t", "--cwd", dir], "you are my pair partner")
  );
  assert.equal(out.threadId, "fake-thread-1");
  assert.equal(out.lastMessage, "hello from codex");

  const argv = readFileSync(env.FAKE_ARGS, "utf8").trim().split("\n");
  assert.deepEqual(argv, [
    "exec", "--json", "--skip-git-repo-check", "-s", "read-only", "-"
  ]);
  assert.equal(readFileSync(env.FAKE_STDIN, "utf8"), "you are my pair partner");

  const state = JSON.parse(readFileSync(env.CODEX_PAIR_STATE_FILE, "utf8"));
  assert.equal(state.pairs.length, 1);
  assert.equal(state.pairs[0].threadId, "fake-thread-1");
  assert.equal(state.pairs[0].cwd, dir);
});

test("start refuses a duplicate label", () => {
  assert.throws(() => run(["start", "--label", "t", "--cwd", dir], "x"));
});

test("send resumes the stored thread without -s", () => {
  const out = JSON.parse(run(["send", "--label", "t", "--kind", "freeform"], "review this diff"));
  assert.equal(out.threadId, "fake-thread-1");
  assert.equal(out.lastMessage, "hello from codex");

  const argv = readFileSync(env.FAKE_ARGS, "utf8").trim().split("\n");
  assert.deepEqual(argv, [
    "exec", "resume", "fake-thread-1", "--json", "--skip-git-repo-check", "-"
  ]);

  const state = JSON.parse(readFileSync(env.CODEX_PAIR_STATE_FILE, "utf8"));
  assert.equal(state.pairs[0].turns, 2);
});

test("send with unknown label fails with available labels", () => {
  assert.throws(() => run(["send", "--label", "nope", "--kind", "freeform"], "x"), /\bt\b/);
});

test("list prints state", () => {
  const out = JSON.parse(run(["list"]));
  assert.equal(out.pairs.length, 1);
  assert.equal(out.pairs[0].label, "t");
});

test("end removes the pair", () => {
  run(["end", "--label", "t"]);
  const out = JSON.parse(run(["list"]));
  assert.equal(out.pairs.length, 0);
});
