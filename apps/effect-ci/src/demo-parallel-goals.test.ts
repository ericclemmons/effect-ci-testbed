import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import * as actions from "../../../examples/demo/.cloudflare/ci/actions.ts";

const workflow = CI.workflow("test-and-build", function* () {
  yield* CI.parallel([actions.test(), actions.build()]);
});

test("deployment preview owns both goals and does not run after a failed test", async () => {
  const calls: string[] = [];
  await assert.rejects(CI.runPromise(CI.workflow("deploy", () => actions.deploy()), {
    output: "silent",
    source: { checkout: () => Effect.succeed(CI.Workspace.local("/demo")) },
    executor: { execute: ({ stepId, command, workspace }) => Effect.suspend(() => {
      calls.push(stepId);
      return stepId === "test" ? Effect.fail(new CI.CommandError(stepId, command, workspace.cwd, 1))
        : Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
    }) },
  }));
  assert.ok(!calls.includes("deploy preview"));
});

test(
  "test and build share setup once, overlap independent checks, then overlap goals",
  { timeout: 5000 },
  async () => {
    const calls: string[] = [];
    const finished = new Set<string>();
    const checks = ["lint", "check", "typecheck"];
    let releaseChecks!: () => void;
    const checksReady = new Promise<void>((resolve) => {
      releaseChecks = resolve;
    });
    let releaseGoals!: () => void;
    const goalsReady = new Promise<void>((resolve) => {
      releaseGoals = resolve;
    });
    let checkouts = 0;
    const result = await CI.runPromise(workflow, {
      output: "silent",
      source: {
        checkout: () =>
          Effect.sync(() => {
            checkouts++;
            return CI.Workspace.local("/demo");
          }),
      },
      executor: {
        execute: ({ stepId }) =>
          Effect.gen(function* () {
            calls.push(stepId);
            if (checks.includes(stepId)) {
              assert.ok(finished.has("install"));
              if (checks.every((id) => calls.includes(id))) releaseChecks();
              yield* Effect.promise(() => checksReady);
            }
            if (stepId === "test" || stepId === "build") {
              assert.ok(checks.every((id) => finished.has(id)));
              if (calls.includes("test") && calls.includes("build")) releaseGoals();
              yield* Effect.promise(() => goalsReady);
            }
            finished.add(stepId);
            return { exitCode: 0, stdout: "", stderr: "" };
          }),
      },
    });
    assert.deepEqual([...calls].sort(), ["install", ...checks, "test", "build"].sort());
    assert.equal(checkouts, 1);
    for (const id of ["test", "build"]) {
      assert.deepEqual(
        [...result.plan.nodes.find((node) => node.id === id)!.dependencies].sort(),
        ["install", ...checks].sort(),
      );
    }
  },
);

test("a failed prerequisite prevents both goals; build alone still resolves its prerequisites", async () => {
  for (const failed of ["lint", "check", "typecheck"]) {
    const calls: string[] = [];
    await assert.rejects(
      CI.runPromise(workflow, {
        output: "silent",
        source: { checkout: () => Effect.succeed(CI.Workspace.local("/demo")) },
        executor: {
          execute: ({ stepId, command, workspace }) =>
            Effect.suspend(() => {
              calls.push(stepId);
              return stepId === failed
                ? Effect.fail(new CI.CommandError(stepId, command, workspace.cwd, 1))
                : Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
            }),
        },
      }),
    );
    assert.ok(!calls.includes("test") && !calls.includes("build"));
  }
  const result = await CI.runPromise(
    CI.workflow("build-only", () => actions.build()),
    {
      mode: "plan",
      output: "silent",
      source: { checkout: () => Effect.succeed(CI.Workspace.local("/demo")) },
    },
  );
  assert.deepEqual(
    result.plan.nodes.map((node) => node.id).sort(),
    ["checkout", "install", "lint", "check", "typecheck", "build"].sort(),
  );
});
