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
if (args[0] !== "agent") {
  process.stderr.write("fake grok: expected agent\n");
  process.exit(1);
}

const state = load();
state.grokStarts = (state.grokStarts ?? 0) + 1;
save(state);

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

let nextSession = 1;

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  switch (message.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { protocolVersion: 1, agentCapabilities: {} }
      });
      break;
    case "session/new": {
      const sessionId = `sess_${nextSession++}`;
      send({ jsonrpc: "2.0", id: message.id, result: { sessionId } });
      break;
    }
    case "session/load":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: message.params.sessionId }
      });
      break;
    case "session/prompt": {
      const texts = (message.params.prompt || [])
        .map((p) => p.text || "")
        .join("\n");
      const isReview = /\/review/i.test(texts);
      const reply = isReview
        ? `## Summary\nLooks risky.\n\n## Issues\n\n### Issue 1 -- Severity: bug\n- File: src/x.rs:10\n- Description: lost update\n- Suggestion: lock it\n- Status: open\n`
        : `grok pair: ${texts.slice(0, 80)}`;
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: reply }
        }
      });
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { stopReason: "end_turn" }
      });
      break;
    }
    case "session/cancel":
      send({ jsonrpc: "2.0", id: message.id, result: {} });
      break;
    default:
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `unknown method ${message.method}` }
      });
  }
});
