import assert from "node:assert/strict";
import test from "node:test";
import * as CI from "./index.ts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Cause from "effect/Cause";

const outage = <A>(kind: string): Effect.Effect<A, Error> => {
  if (kind === "throw") throw Error("cache adapter unavailable");
  if (kind === "defect") return Effect.die(Error("cache adapter unavailable"));
  if (kind === "interrupt") return Effect.interrupt;
  return Effect.fail(Error("cache adapter unavailable"));
};

for (const store of ["result", "check"] as const) {
  for (const operation of ["lookup", "record"] as const) {
    test(`${store} ${operation} outages execute normally without fabricating reuse`, async () => {
      for (const kind of ["typed", "throw", "defect"]) {
        let bodies = 0, commands = 0, records = 0;
        const check = CI.check("test", () => function* () {
          bodies++;
          yield* CI.Workspace.local("/fixture").exec("pnpm test");
        }, { reuse: { scope: "commit" } });
        const result = await CI.runPromise(CI.workflow("cache-outage", () => check()), {
          output: "silent",
          executor: { execute: () => Effect.sync(() => {
            commands++;
            return { exitCode: 0, stdout: "actual test output", stderr: "" };
          }) },
          ...(store === "result" ? { stepResultCache: {
            lookup: () => operation === "lookup" ? outage<undefined>(kind) : Effect.succeed(undefined),
            record: () => { records++; return operation === "record" ? outage<void>(kind) : Effect.void; },
          } } : { checkCache: {
            lookup: () => operation === "lookup" ? outage<boolean>(kind) : Effect.succeed(false),
            record: () => { records++; return operation === "record" ? outage<void>(kind) : Effect.void; },
          } }),
        });
        assert.equal(result.attempt.conclusion, "success");
        assert.equal(result.plan.nodes.find(node => node.id === "test")?.status, "complete");
        assert.deepEqual([bodies, commands, records], [1, 1, 1]);
      }
    });

    test(`${store} ${operation} interruption is not converted to a miss or success`, async () => {
      let bodies = 0, commands = 0;
      const check = CI.check("test", () => function* () {
        bodies++;
        yield* CI.Workspace.local("/fixture").exec("pnpm test");
      }, { reuse: { scope: "commit" } });
      const result = await Effect.runPromise(Effect.exit(CI.run(CI.workflow("cache-interrupt", () => check()), {
        output: "silent",
        executor: { execute: () => Effect.sync(() => { commands++; return { exitCode: 0, stdout: "", stderr: "" }; }) },
        ...(store === "result" ? { stepResultCache: {
          lookup: () => operation === "lookup" ? outage<undefined>("interrupt") : Effect.succeed(undefined),
          record: () => outage<void>("interrupt"),
        } } : { checkCache: {
          lookup: () => operation === "lookup" ? outage<boolean>("interrupt") : Effect.succeed(false),
          record: () => outage<void>("interrupt"),
        } }),
      })));
      assert.ok(Exit.isFailure(result));
      assert.equal(Cause.hasInterrupts(result.cause), true);
      assert.equal(bodies, store === "result" && operation === "lookup" ? 0 : 1);
      assert.equal(commands, operation === "lookup" ? 0 : 1);
    });
  }
}
