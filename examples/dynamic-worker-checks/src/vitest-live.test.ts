import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { assertionModes } from "./vitest-fixture.ts";
import { verifyAssertionHistory } from "./vitest-evidence.ts";

// GET-only. Enable only after the six create-once owned cases actually exist.
// Pin the Workflow version from the independent deployment/case receipt.
test("retained native Vitest subset cases share the pinned tool and Workflow version", {
  skip: process.env.LIVE_OWNED_VITEST !== "1",
}, () => {
  const version = process.env.VITEST_WORKFLOW_VERSION;
  assert.ok(version, "Pin the independently recorded Workflow version before reading evidence");
  const digests = new Set<string>();
  for (const mode of assertionModes) {
    const owner = `owned-vitest-${mode}-20261016-1`;
    const h = JSON.parse(execFileSync(process.env.CF_BIN ?? "cf", ["workflows", "instances", "get", owner,
      "--workflow-name", "effect-ci-vitest-subset-checks"], { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }));
    digests.add(verifyAssertionHistory(h, mode, owner, version));
  }
  assert.equal(digests.size, 1, "All cases must execute the same trusted assertion bundle");
});
