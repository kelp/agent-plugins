#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const stateFile = process.env.HARNESS_FAKE_STATE;
function load() {
  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}
function save(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state) + "\n");
}

const args = process.argv.slice(2);
if (args[0] !== "app-server") {
  process.stderr.write("fake codex: expected app-server\n");
  process.exit(1);
}

const state = load();
state.codexStarts = (state.codexStarts ?? 0) + 1;
state.threads = state.threads ?? {};
save(state);

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

let nextThread = 1;
let nextTurn = 1;

function reviewText(target) {
  return JSON.stringify({
    verdict: "needs-attention",
    summary: "Codex native review",
    findings: [
      {
        severity: "high",
        title: "Race",
        body: "lost update",
        file: "src/x.rs",
        line_start: 10,
        line_end: 12,
        recommendation: "lock it"
      }
    ]
  });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  switch (message.method) {
    case "initialize":
      send({ id: message.id, result: { userAgent: "fake-codex-app-server" } });
      break;
    case "initialized":
      break;
    case "thread/start": {
      const id = `thr_${nextThread++}`;
      const st = load();
      st.threads[id] = { cwd: message.params?.cwd, turns: [] };
      save(st);
      send({ id: message.id, result: { thread: { id } } });
      send({ method: "thread/started", params: { thread: { id } } });
      break;
    }
    case "thread/resume":
      send({
        id: message.id,
        result: { thread: { id: message.params.threadId } }
      });
      break;
    case "review/start": {
      const turnId = `turn_${nextTurn++}`;
      const threadId = message.params.threadId;
      send({
        id: message.id,
        result: { turn: { id: turnId, status: "inProgress" }, reviewThreadId: threadId }
      });
      send({
        method: "turn/started",
        params: { threadId, turn: { id: turnId } }
      });
      send({
        method: "item/completed",
        params: {
          threadId,
          item: {
            type: "exitedReviewMode",
            id: turnId,
            review: reviewText(message.params.target)
          }
        }
      });
      send({
        method: "turn/completed",
        params: { threadId, turn: { id: turnId, status: "completed" } }
      });
      break;
    }
    case "turn/start": {
      const turnId = `turn_${nextTurn++}`;
      const threadId = message.params.threadId;
      const prompt = (message.params.input || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      send({
        id: message.id,
        result: { turn: { id: turnId, status: "inProgress" } }
      });
      send({
        method: "turn/started",
        params: { threadId, turn: { id: turnId } }
      });
      send({
        method: "item/completed",
        params: {
          threadId,
          item: {
            type: "agentMessage",
            id: `msg_${turnId}`,
            text: `codex pair: ${prompt.slice(0, 80)}`
          }
        }
      });
      send({
        method: "turn/completed",
        params: { threadId, turn: { id: turnId, status: "completed" } }
      });
      break;
    }
    case "turn/interrupt":
      send({ id: message.id, result: {} });
      break;
    default:
      send({
        id: message.id,
        error: { code: -32601, message: `unknown method ${message.method}` }
      });
  }
});
