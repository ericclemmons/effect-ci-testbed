import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import * as CI from "@effect-ci-testbed/ci";
import { syntaxCommand, syntaxPaths } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { demoCheckCache } from "./demo-check-cache.ts";

test("host evidence network reads run inside a durable action, after workspace inspection", async () => {
  let insideAction = false;
  let networkInsideAction: boolean | undefined;
  let inspected = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkInsideAction = insideAction;
    return new Response("{}", { status: 404 });
  };
  try {
    const runner: any = {
      executor: { execute: () => Effect.sync(() => {
        assert.equal(insideAction, false, "native command checkpoints must not nest");
        inspected = true;
        return { exitCode: 0, stderr: "", stdout: JSON.stringify({
          version: 1, files: syntaxPaths.map(path => ({ path, size: 1, sha256: "a".repeat(64) })),
          node: "b".repeat(64), runtime: "v24.22.0", platform: "linux", arch: "x64", versions: { node: "24.22.0" },
        }) };
      }) },
      actionExecutor: { execute: (request: any) => Effect.promise(async () => {
        assert.equal(inspected, true);
        insideAction = true;
        try { return await Effect.runPromise(request.run(1)); }
        finally { insideAction = false; }
      }) },
    };
    const revision = "c".repeat(40);
    const hit = await Effect.runPromise(demoCheckCache(runner).lookup({
      workflowId: "cf-ci-demo", stepId: "syntax", command: syntaxCommand,
      policy: { scope: "commit" }, workspace: CI.Workspace.remote("fixture", "/workspace/repository/examples/demo"),
      event: { type: "workflow_dispatch", revision, source: { kind: "git", repository: "https://github.com/ericclemmons/effect-ci-testbed.git", revision } },
    }));
    assert.equal(hit, false, "404 remains an ordinary execution miss");
    assert.equal(networkInsideAction, true);
  } finally { globalThis.fetch = originalFetch; }
});
