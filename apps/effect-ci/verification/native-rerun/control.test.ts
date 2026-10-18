import assert from "node:assert/strict";
import test from "node:test";
import { emptyParameters, once, cleanupOnce, scopedSteps } from "./control.ts";

test("only an empty JSON object can start the fixed proof", () => {
  assert.doesNotThrow(() => emptyParameters({}));
  for (const value of [undefined, null, "", "{}", 0, false, [], { revision: "main" },
    new Date(), Object.create(null), { [Symbol("hidden")]: true }]) {
    assert.throws(() => emptyParameters(value), /empty parameters object/);
  }
});

test("native operations and cleanup have bounded timeouts without automatic retries", () => {
  assert.deepEqual(once, { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" });
  assert.deepEqual(cleanupOnce, { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" });
});

test("scoped native RPC methods are invoked directly, not through a remote call method", async () => {
  const names: string[] = [];
  const remote = Object.assign(async (name: string, config: unknown, body: () => Promise<unknown>) => {
    names.push(name); assert.deepEqual(config, once); return body();
  }, { call() { throw Error("The RPC receiver does not implement the method call"); } });
  const scoped = scopedSteps({ do: remote } as any, "original");
  assert.equal(await scoped.do("source", async () => "prepared"), "prepared");
  assert.deepEqual(names, ["original:source"]);
});
