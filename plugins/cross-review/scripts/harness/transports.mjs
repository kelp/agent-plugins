import { spawn } from "node:child_process";
import { JsonlRpc } from "./rpc.mjs";
import { parseFindings } from "./core.mjs";

const TURN_TIMEOUT_MS = 120000;

function envelope(harness, target, raw, extra = {}) {
  const parsed = parseFindings(harness, raw);
  return {
    harness,
    ok: extra.ok !== false,
    target,
    summary: parsed.summary,
    findings: parsed.findings,
    native: { raw },
    sessionId: extra.sessionId ?? null,
    error: extra.error ?? null
  };
}

function spawnProc(command, args, cwd, env) {
  const proc = spawn(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", () => {});
  return proc;
}

function collectUntil(rpc, timeoutMs, isDone) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      rpc.onNotification = prev;
      reject(new Error("timed out waiting for turn"));
    }, timeoutMs);
    const prev = rpc.onNotification;
    rpc.onNotification = (message) => {
      prev?.(message);
      if (isDone(message)) {
        clearTimeout(timer);
        rpc.onNotification = prev;
        resolve();
      }
    };
  });
}

export class CodexTransport {
  constructor(cwd, env) {
    this.cwd = cwd;
    this.env = env;
    this.harness = "codex";
    this.proc = null;
    this.rpc = null;
  }

  async start() {
    this.proc = spawnProc("codex", ["app-server"], this.cwd, this.env);
    this.rpc = new JsonlRpc(this.proc.stdin, this.proc.stdout);
    await this.rpc.request("initialize", {
      clientInfo: { name: "harness", title: "harness", version: "0.1.0" },
      capabilities: { experimentalApi: false }
    });
    this.rpc.notify("initialized", {});
  }

  async review(target) {
    const thread = await this.rpc.request("thread/start", {
      cwd: this.cwd,
      sandbox: "read-only"
    });
    const threadId = thread.thread.id;
    const raw = await this.withTurn(async () => {
      await this.rpc.request("review/start", {
        threadId,
        delivery: "inline",
        target: codexTarget(target)
      });
    });
    return envelope("codex", target, raw, { sessionId: threadId });
  }

  async pairStart(prompt) {
    const thread = await this.rpc.request("thread/start", {
      cwd: this.cwd,
      sandbox: "read-only"
    });
    const text = await this.turn(thread.thread.id, prompt);
    return { sessionId: thread.thread.id, lastMessage: text };
  }

  async pairSend(sessionId, prompt) {
    await this.rpc.request("thread/resume", { threadId: sessionId, cwd: this.cwd });
    const text = await this.turn(sessionId, prompt);
    return { sessionId, lastMessage: text };
  }

  async withTurn(send) {
    let raw = "";
    const wait = collectUntil(this.rpc, TURN_TIMEOUT_MS, (message) => {
      if (message.method === "item/completed") {
        const item = message.params?.item ?? {};
        if (item.type === "exitedReviewMode" && item.review) {
          raw = String(item.review);
        }
        if ((item.type === "agentMessage" || item.type === "agent_message") && item.text) {
          raw = String(item.text);
        }
      }
      return message.method === "turn/completed";
    });
    await send();
    await wait;
    return raw;
  }

  async turn(threadId, prompt) {
    return this.withTurn(async () => {
      await this.rpc.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt }]
      });
    });
  }

  async stop() {
    this.rpc?.close();
    this.proc?.kill("SIGTERM");
  }
}

function codexTarget(target) {
  if (target.kind === "branch") return { type: "baseBranch", branch: target.ref };
  if (target.kind === "commit") return { type: "commit", sha: target.sha };
  return { type: "uncommittedChanges" };
}

export class GrokTransport {
  constructor(cwd, env) {
    this.cwd = cwd;
    this.env = env;
    this.harness = "grok";
    this.proc = null;
    this.rpc = null;
  }

  async start() {
    this.proc = spawnProc(
      "grok",
      ["agent", "--always-approve", "stdio"],
      this.cwd,
      this.env
    );
    this.rpc = new JsonlRpc(this.proc.stdin, this.proc.stdout, { jsonrpc: true });
    await this.rpc.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "harness", version: "0.1.0" },
      clientCapabilities: {}
    });
  }

  async newSession() {
    const result = await this.rpc.request("session/new", {
      cwd: this.cwd,
      mcpServers: []
    });
    return result.sessionId;
  }

  async prompt(sessionId, text) {
    let raw = "";
    const prev = this.rpc.onNotification;
    this.rpc.onNotification = (message) => {
      prev?.(message);
      if (message.method === "session/update") {
        const update = message.params ?? {};
        if (update.sessionUpdate === "agent_message_chunk") {
          raw += update.content?.text ?? update.text ?? "";
        }
      }
    };
    try {
      await this.rpc.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }]
      });
      return raw;
    } finally {
      this.rpc.onNotification = prev;
    }
  }

  async review(target) {
    const sessionId = await this.newSession();
    const command = grokReviewCommand(target);
    const raw = await this.prompt(sessionId, command);
    return envelope("grok", target, raw, { sessionId });
  }

  async pairStart(prompt) {
    const sessionId = await this.newSession();
    const lastMessage = await this.prompt(sessionId, prompt);
    return { sessionId, lastMessage };
  }

  async pairSend(sessionId, prompt) {
    const lastMessage = await this.prompt(sessionId, prompt);
    return { sessionId, lastMessage };
  }

  async stop() {
    this.rpc?.close();
    this.proc?.kill("SIGTERM");
  }
}

function grokReviewCommand(target) {
  if (target.kind === "branch") return `/review --branch ${target.ref}`;
  if (target.kind === "pr") return `/review --pr ${target.number}`;
  return "/review --local";
}

export class ClaudeTransport {
  constructor(cwd, env) {
    this.cwd = cwd;
    this.env = env;
    this.harness = "claude";
    this.proc = null;
    this.rpc = null;
    this.buffer = "";
    this.pending = [];
  }

  async start() {
    this.proc = spawnProc(
      "claude",
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "dontAsk"
      ],
      this.cwd,
      this.env
    );
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this.handleChunk(chunk));
  }

  handleChunk(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.type === "result") {
        const waiter = this.pending.shift();
        waiter?.resolve(message.result ?? "");
      }
    }
  }

  sendPrompt(text) {
    const payload = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }]
      }
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for claude result"));
      }, TURN_TIMEOUT_MS);
      this.pending.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject
      });
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async review(target) {
    const raw = await this.sendPrompt(claudeReviewCommand(target));
    return envelope("claude", target, raw);
  }

  async pairStart(prompt) {
    const lastMessage = await this.sendPrompt(prompt);
    return { sessionId: "claude-stream", lastMessage };
  }

  async pairSend(_sessionId, prompt) {
    const lastMessage = await this.sendPrompt(prompt);
    return { sessionId: "claude-stream", lastMessage };
  }

  async stop() {
    this.proc?.stdin.end();
    this.proc?.kill("SIGTERM");
  }
}

function claudeReviewCommand(target) {
  if (target.kind === "branch") return `/code-review ${target.ref}`;
  if (target.kind === "pr") return `/code-review ${target.number}`;
  if (target.kind === "commit") return `/code-review ${target.sha}`;
  return "/code-review";
}

export function createTransport(harness, cwd, env) {
  if (harness === "codex") return new CodexTransport(cwd, env);
  if (harness === "grok") return new GrokTransport(cwd, env);
  if (harness === "claude") return new ClaudeTransport(cwd, env);
  throw new Error(`unknown harness ${harness}`);
}
