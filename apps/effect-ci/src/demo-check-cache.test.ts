import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import * as CI from "@effect-ci-testbed/ci";
import { syntaxCommand, syntaxPaths } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { demoCheckCache } from "./demo-check-cache.ts";
import {
  testCommand,
  testFixedInputs,
  testPaths,
} from "@effect-ci-testbed/cloudflare/demo-test-check";

for (const suite of [false, true])
  test(`${suite ? "test suite" : "syntax"} evidence reads run inside a durable action, after workspace inspection`, async () => {
    let insideAction = false;
    let networkInsideAction: boolean | undefined;
    let inspected = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      networkInsideAction = insideAction;
      assert.ok(
        String(url).endsWith(
          suite ? "ref/notes/effect-ci-demo-tests-v1" : "ref/notes/effect-ci-hosted-checks-v1",
        ),
      );
      return new Response("{}", { status: 404 });
    };
    try {
      const runner: any = {
        executor: {
          execute: () =>
            Effect.sync(() => {
              assert.equal(insideAction, false, "native command checkpoints must not nest");
              inspected = true;
              return {
                exitCode: 0,
                stderr: "",
                stdout: JSON.stringify({
                  version: 1,
                  files: (suite ? testPaths : syntaxPaths).map((path) => ({
                    path,
                    size: 1,
                    sha256: suite ? (testFixedInputs[path] ?? "a".repeat(64)) : "a".repeat(64),
                  })),
                  dependencies: "d".repeat(64),
                  dependencyFiles: 100,
                  node: "b".repeat(64),
                  runtime: "v24.22.0",
                  platform: "linux",
                  arch: "x64",
                  versions: { node: "24.22.0" },
                }),
              };
            }),
        },
        actionExecutor: {
          execute: (request: any) =>
            Effect.promise(async () => {
              assert.equal(inspected, true);
              insideAction = true;
              try {
                return await Effect.runPromise(request.run(1));
              } finally {
                insideAction = false;
              }
            }),
        },
      };
      const revision = "c".repeat(40);
      const hit = await Effect.runPromise(
        demoCheckCache(runner).lookup({
          workflowId: "cf-ci-demo",
          stepId: suite ? "test" : "syntax",
          command: suite ? testCommand : syntaxCommand,
          policy: { scope: "commit" },
          workspace: CI.Workspace.remote("fixture", "/workspace/repository/examples/demo"),
          event: {
            type: "workflow_dispatch",
            revision,
            source: {
              kind: "git",
              repository: "https://github.com/ericclemmons/effect-ci-testbed.git",
              revision,
            },
          },
        }),
      );
      assert.equal(hit, false, "404 remains an ordinary execution miss");
      assert.equal(networkInsideAction, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
