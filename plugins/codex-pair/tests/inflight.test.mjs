import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  claimInFlight,
  releaseInFlight,
  isInFlight,
  getPair,
  upsertPair
} from "../scripts/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "scripts", "codex-pair.mjs");

// --- pure token logic ---

const NOW = Date.parse("2026-07-23T00:00:00Z");
const LATER = new Date(NOW + 60_000).toISOString();
const EARLIER = new Date(NOW - 60_000).toISOString();

const basePair = {
  label: "a",
  threadId: "t-a",
  cwd: "/repo",
  createdAt: "2026-07-22T00:00:00Z",
  lastUsedAt: "2026-07-22T00:00:00Z",
  turns: 1
};

test("claimInFlight sets a token on a free pair", () => {
  const s = upsertPair({ pairs: [] }, basePair);
  const claimed = claimInFlight(s, "a", { pid: 1, expiresAt: LATER }, NOW);
  assert.equal(getPair(claimed, "a").inFlight.pid, 1);
  assert.ok(isInFlight(getPair(claimed, "a"), NOW));
});

test("claimInFlight rejects an active token, steals an expired one", () => {
  const s = upsertPair({ pairs: [] }, basePair);
  const claimed = claimInFlight(s, "a", { pid: 1, expiresAt: LATER }, NOW);
  assert.throws(
    () => claimInFlight(claimed, "a", { pid: 2, expiresAt: LATER }, NOW),
    /in flight/i
  );
  const stale = upsertPair({ pairs: [] }, {
    ...basePair,
    inFlight: { pid: 9, expiresAt: EARLIER }
  });
  const stolen = claimInFlight(stale, "a", { pid: 2, expiresAt: LATER }, NOW);
  assert.equal(getPair(stolen, "a").inFlight.pid, 2);
});

test("releaseInFlight clears only its own token", () => {
  const s = upsertPair({ pairs: [] }, basePair);
  const claimed = claimInFlight(s, "a", { pid: 1, expiresAt: LATER }, NOW);
  const kept = releaseInFlight(claimed, "a", 2);
  assert.ok(getPair(kept, "a").inFlight);
  const cleared = releaseInFlight(claimed, "a", 1);
  assert.equal(getPair(cleared, "a").inFlight, undefined);
});

// --- CLI: second concurrent send must never reach codex ---

let dir;
let stateFile;
let env;

// Fake codex: records each invocation, then holds the turn open
// long enough that a second send overlaps it.
const SLOW_FAKE = `#!/bin/sh
echo run >> "$FAKE_COUNT"
cat > /dev/null
sleep 2
cat <<'EOF'
{"type":"thread.started","thread_id":"t-a"}
{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"ok"}}
EOF
`;

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), "codex-pair-inflight-"));
  stateFile = path.join(dir, "pairs.json");
  const fake = path.join(dir, "codex");
  writeFileSync(fake, SLOW_FAKE);
  chmodSync(fake, 0o755);
  writeFileSync(stateFile, JSON.stringify({
    pairs: [{ ...basePair, cwd: dir }]
  }));
  env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    CODEX_PAIR_STATE_FILE: stateFile,
    FAKE_COUNT: path.join(dir, "count.txt")
  };
});

after(() => rmSync(dir, { recursive: true, force: true }));

function sendOnce() {
  return new Promise((resolve) => {
    const child = spawn("node", [cli, "send", "--label", "a", "--kind", "freeform"], { env });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    child.stdin.end("hello");
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("concurrent send fails fast without invoking codex", async () => {
  const first = sendOnce();
  await new Promise((r) => setTimeout(r, 500));
  const second = await sendOnce();
  const firstResult = await first;

  assert.equal(firstResult.code, 0);
  assert.equal(second.code, 1);
  assert.match(second.stderr, /in flight/i);

  const runs = readFileSync(env.FAKE_COUNT, "utf8").trim().split("\n");
  assert.equal(runs.length, 1);

  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.pairs[0].turns, 2);
  assert.equal(state.pairs[0].inFlight, undefined);
});
