import assert from "node:assert/strict";
import test from "node:test";
import { monorepoAllowed, monorepoGitHubRun } from "./monorepo-policy.ts";
const identity = { repository: "https://github.com/ericclemmons/effect-ci-testbed", repositoryName: "ericclemmons/effect-ci-testbed",
  revision: "a".repeat(40), installationId: 165265172, ref: "refs/heads/main" };
test("only enrolled monorepo sources select the native root workflow", () => {
  const workflow = {};
  for (const ref of ["refs/heads/main", "refs/heads/feature/demo"]) {
    const value = { ...identity, ref };
    assert.ok(monorepoAllowed(value));
    assert.deepEqual(monorepoGitHubRun(value as any, {} as any, { exports: { EffectCIWorkflow: workflow } } as any), { workflow });
  }
  for (const update of [{ installationId: 1 }, { repositoryName: "foreign/repo" }, { revision: "main" }, { ref: "refs/tags/v1" }])
    assert.equal(monorepoGitHubRun({ ...identity, ...update } as any, {} as any, {} as any), false);
});
