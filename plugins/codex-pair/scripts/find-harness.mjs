import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIBLING = fileURLToPath(
  new URL("../../cross-review/scripts/harness/lifecycle.mjs", import.meta.url)
);

function newest(dir) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir)
    .map((name) => {
      const full = path.join(dir, name, "scripts", "harness", "lifecycle.mjs");
      return { full, mtime: fs.existsSync(full) ? fs.statSync(full).mtimeMs : 0 };
    })
    .filter((e) => e.mtime > 0)
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.full ?? null;
}

export function findHarnessLifecycle() {
  if (process.env.HARNESS_LIFECYCLE) return process.env.HARNESS_LIFECYCLE;
  if (fs.existsSync(SIBLING)) return SIBLING;
  const home = os.homedir();
  const cached = newest(
    path.join(home, ".claude", "plugins", "cache", "agent-plugins", "cross-review")
  );
  if (cached) return cached;
  const markets = path.join(home, ".claude", "plugins", "marketplaces");
  if (fs.existsSync(markets)) {
    for (const market of fs.readdirSync(markets)) {
      const candidate = path.join(
        markets,
        market,
        "plugins",
        "cross-review",
        "scripts",
        "harness",
        "lifecycle.mjs"
      );
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export async function requestHarnessBroker(cwd, method, params) {
  const spec = findHarnessLifecycle();
  if (!spec) {
    throw new Error(
      "harness pool not found; install the cross-review plugin or set HARNESS_LIFECYCLE"
    );
  }
  const href = spec.startsWith("file:") ? spec : pathToFileUrl(spec);
  const mod = await import(href);
  return mod.requestBroker(cwd, method, params);
}

function pathToFileUrl(file) {
  const resolved = path.resolve(file);
  return `file://${resolved}`;
}
