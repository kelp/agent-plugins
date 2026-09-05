#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { createTransport } from "./harness/transports.mjs";

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      flags[key] = value;
    } else {
      rest.push(argv[i]);
    }
  }
  return { flags, rest };
}

const { flags, rest } = parseArgs(process.argv.slice(2));
if (rest[0] !== "serve") {
  throw new Error("Usage: harness-broker.mjs serve --endpoint <sock> --cwd <path>");
}
if (!flags.endpoint) throw new Error("missing --endpoint");

const cwd = flags.cwd ? flags.cwd : process.cwd();
const idleMs = Number(process.env.HARNESS_IDLE_MS ?? 15 * 60 * 1000);
if (flags["pid-file"]) {
  fs.mkdirSync(path.dirname(flags["pid-file"]), { recursive: true });
  fs.writeFileSync(flags["pid-file"], `${process.pid}\n`);
}

const slots = new Map();
const pairs = new Map();
let idleTimer = null;
let lastUsed = Date.now();

function touch() {
  lastUsed = Date.now();
  if (!idleMs || idleMs <= 0) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (pairs.size > 0) {
      touch();
      return;
    }
    void stopSlots();
  }, idleMs);
}

function slotKey(harness, role) {
  if (harness === "claude") return `claude:${role}`;
  return harness;
}

async function getSlot(harness, role) {
  const key = slotKey(harness, role);
  const existing = slots.get(key);
  if (existing) return existing;
  const transport = createTransport(harness, cwd, process.env);
  await transport.start();
  slots.set(key, transport);
  return transport;
}

async function stopSlots() {
  for (const transport of slots.values()) {
    await transport.stop().catch(() => {});
  }
  slots.clear();
}

function send(socket, message) {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(message)}\n`);
}

async function handle(method, params) {
  touch();
  switch (method) {
    case "review/run": {
      const callees = params.callees ?? [];
      const target = params.target;
      const results = await Promise.all(
        callees.map(async (harness) => {
          try {
            const transport = await getSlot(harness, "review");
            return await transport.review(target);
          } catch (err) {
            return {
              harness,
              ok: false,
              target,
              summary: "",
              findings: [],
              native: { raw: "" },
              error: err instanceof Error ? err.message : String(err)
            };
          }
        })
      );
      return { results };
    }
    case "pair/start": {
      const label = params.label ?? "default";
      if (pairs.has(label)) {
        throw new Error(`pair '${label}' already exists`);
      }
      const transport = await getSlot(params.harness, "pair");
      const started = await transport.pairStart(params.prompt ?? "");
      pairs.set(label, {
        label,
        harness: params.harness,
        sessionId: started.sessionId,
        cwd
      });
      return { ...started, harness: params.harness, label };
    }
    case "pair/send": {
      const pair = pairs.get(params.label);
      if (!pair) throw new Error(`no pair named '${params.label}'`);
      const transport = await getSlot(pair.harness, "pair");
      const sent = await transport.pairSend(pair.sessionId, params.prompt ?? "");
      pair.sessionId = sent.sessionId;
      return { ...sent, harness: pair.harness, label: pair.label };
    }
    case "pair/end": {
      const label = params.label ?? "default";
      if (!pairs.has(label)) throw new Error(`no pair named '${label}'`);
      pairs.delete(label);
      return { ok: true, label };
    }
    case "pair/list":
      return { pairs: [...pairs.values()] };
    case "pool/status":
      return {
        slots: [...slots.keys()].map((key) => ({ key })),
        pairs: [...pairs.values()],
        lastUsed
      };
    case "pool/stop":
    case "broker/shutdown":
      await stopSlots();
      setTimeout(() => process.exit(0), 10).unref();
      return { ok: true };
    default:
      throw new Error(`unknown method ${method}`);
  }
}

try {
  fs.unlinkSync(flags.endpoint);
} catch {
  // nothing to remove
}

const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (err) {
        send(socket, { id: null, error: { message: err.message } });
        continue;
      }
      Promise.resolve()
        .then(() => handle(message.method, message.params ?? {}))
        .then((result) => send(socket, { id: message.id, result }))
        .catch((err) =>
          send(socket, {
            id: message.id,
            error: { message: err instanceof Error ? err.message : String(err) }
          })
        );
    }
  });
});

server.listen(flags.endpoint);
touch();
