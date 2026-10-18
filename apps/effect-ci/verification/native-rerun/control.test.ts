import assert from "node:assert/strict";
import test from "node:test";
import { emptyParameters, once, cleanupOnce } from "./control.ts";

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
