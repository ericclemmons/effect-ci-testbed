import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("documented recipe plans are independent of the enclosing main CI event", () => {
  const result = spawnSync(process.execPath, ["scripts/check-example-plans.ts"], {
    encoding: "utf8", timeout: 30_000,
    env: { ...process.env, EFFECT_CI_NATIVE_PREPARE: "1", EFFECT_CI_EVENT: "push",
      GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main",
      EFFECT_CI_REVISION: "a".repeat(40), GITHUB_SHA: "a".repeat(40),
      GITHUB_REPOSITORY: "fixture/enclosing-monorepo" },
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr ?? result.stdout);
});
