import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const BROKER_SCRIPT = fileURLToPath(new URL("../harness-broker.mjs", import.meta.url));

export function resolvePoolDir(cwd, env = process.env) {
  if (env.HARNESS_POOL_DIR) return env.HARNESS_POOL_DIR;
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 12);
  return path.join(os.homedir(), ".claude", "harness-pool", hash);
}

export function brokerPaths(cwd, env = process.env) {
  const dir = resolvePoolDir(cwd, env);
  return {
    dir,
    socket: path.join(dir, "broker.sock"),
    pidFile: path.join(dir, "broker.pid"),
    logFile: path.join(dir, "broker.log")
  };
}

function connect(socketPath) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ path: socketPath });
    socket.once("connect", () => resolve(socket));
    socket.once("error", () => resolve(null));
  });
}

export async function waitForBroker(socketPath, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const socket = await connect(socketPath);
    if (socket) {
      socket.end();
      return true;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return false;
}

export async function ensureBroker(cwd, env = process.env) {
  const paths = brokerPaths(cwd, env);
  fs.mkdirSync(paths.dir, { recursive: true });
  const existing = await connect(paths.socket);
  if (existing) {
    existing.end();
    return paths;
  }
  try {
    fs.unlinkSync(paths.socket);
  } catch {
    // no stale socket
  }
  const logFd = fs.openSync(paths.logFile, "a");
  const child = spawn(
    process.execPath,
    [
      BROKER_SCRIPT,
      "serve",
      "--endpoint",
      paths.socket,
      "--cwd",
      cwd,
      "--pid-file",
      paths.pidFile
    ],
    {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", logFd, logFd]
    }
  );
  child.unref();
  fs.closeSync(logFd);
  const ready = await waitForBroker(paths.socket);
  if (!ready) {
    throw new Error(`harness broker failed to start (see ${paths.logFile})`);
  }
  return paths;
}

export async function requestBroker(cwd, method, params, env = process.env) {
  const paths = await ensureBroker(cwd, env);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: paths.socket });
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id: 1, method, params })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const idx = buffer.indexOf("\n");
      if (idx === -1) return;
      const line = buffer.slice(0, idx);
      let message;
      try {
        message = JSON.parse(line);
      } catch (err) {
        reject(err);
        socket.end();
        return;
      }
      if (message.error) {
        reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
      socket.end();
    });
    socket.on("error", reject);
  });
}
