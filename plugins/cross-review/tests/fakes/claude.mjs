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
const stream = args.includes("--input-format") || args.includes("stream-json");
if (!stream && !args.includes("-p") && !args.includes("--print")) {
  process.stderr.write("fake claude: expected -p\n");
  process.exit(1);
}

const state = load();
state.claudeStarts = (state.claudeStarts ?? 0) + 1;
save(state);

function emitResult(text) {
  process.stdout.write(
    `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })}\n`
  );
  process.stdout.write(
    `${JSON.stringify({ type: "result", subtype: "success", result: text })}\n`
  );
}

if (stream) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const text =
      message.message?.content?.map((c) => c.text || "").join("\n") ||
      message.content ||
      "";
    const isReview = /\/code-review|\/review/i.test(text);
    const reply = isReview
      ? `Correctness look.\n\nFindings:\n- [Important] Race (src/x.rs:10)\n  lost update on the counter\n`
      : `claude pair: ${String(text).slice(0, 80)}`;
    emitResult(reply);
  });
} else {
  const prompt = args.filter((a) => !a.startsWith("-")).join(" ") || "";
  emitResult(
    /\/code-review|\/review/i.test(prompt)
      ? `Correctness look.\n\nFindings:\n- [Important] Race (src/x.rs:10)\n  lost update on the counter\n`
      : `claude pair: ${prompt.slice(0, 80)}`
  );
}
