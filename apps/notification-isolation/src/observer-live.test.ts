import { execFileSync } from "node:child_process";
import test from "node:test";
import { verifyObserverHistory } from "./observer-evidence.ts";

// GET-only. Fill version pins from independent native deployment receipts.
const enabled = process.env.LIVE_RUNTIME_OBSERVERS === "1";
for (const mode of ["observer-success", "observer-business-failure"] as const) {
  test(`retained native generic runtime ${mode}`, { skip: !enabled }, () => {
    const owner = "owned-" + mode + "-20261016-1";
    const h = JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", ["workflows", "instances", "get", owner,
      "--workflow-name", "effect-ci-provider-isolation"], { encoding: "utf8", timeout: 60000,
      maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
    verifyObserverHistory(h, mode, owner, process.env.OBSERVER_WORKER_VERSION ?? "", process.env.OBSERVER_WORKFLOW_VERSION ?? "");
  });
}
