#!/usr/bin/env node
import process from "node:process";
import { parseCallees, parseTarget, mergeByLocation } from "./harness/core.mjs";
import { requestBroker } from "./harness/lifecycle.mjs";

function parseArgv(argv) {
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

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString()));
    process.stdin.on("error", () => resolve(""));
  });
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const { flags, rest } = parseArgv(process.argv.slice(2));
  const cwd = flags.cwd ? flags.cwd : process.cwd();
  const [command, sub] = rest;

  if (command === "review") {
    const callees = parseCallees(
      flags.callees != null ? [String(flags.callees)] : rest.slice(1)
    );
    const target = parseTarget(flags.target ?? null);
    const result = await requestBroker(cwd, "review/run", { callees, target });
    result.merged = mergeByLocation(result.results);
    print(result);
    return;
  }

  if (command === "pair") {
    if (sub === "start") {
      const prompt = await readStdin();
      const result = await requestBroker(cwd, "pair/start", {
        harness: flags.harness ?? "codex",
        label: flags.label ?? "default",
        prompt
      });
      print(result);
      return;
    }
    if (sub === "send") {
      const prompt = await readStdin();
      const result = await requestBroker(cwd, "pair/send", {
        label: flags.label ?? "default",
        prompt
      });
      print(result);
      return;
    }
    if (sub === "end") {
      print(
        await requestBroker(cwd, "pair/end", { label: flags.label ?? "default" })
      );
      return;
    }
    if (sub === "list") {
      print(await requestBroker(cwd, "pair/list", {}));
      return;
    }
    throw new Error("usage: harness.mjs pair start|send|end|list");
  }

  if (command === "pool") {
    if (sub === "status") {
      print(await requestBroker(cwd, "pool/status", {}));
      return;
    }
    if (sub === "stop") {
      print(await requestBroker(cwd, "pool/stop", {}));
      return;
    }
    throw new Error("usage: harness.mjs pool status|stop");
  }

  throw new Error(
    "usage: harness.mjs review|pair|pool [--callees a,b] [--target T] [--cwd D]"
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
