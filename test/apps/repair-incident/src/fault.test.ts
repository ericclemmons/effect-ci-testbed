import assert from "node:assert/strict";
import test from "node:test";
import { mode, healthStatus, ERROR_MESSAGE } from "./fault.ts";
test("fixed owned failure and exact accessor-safe modes", () => {
  assert.equal(healthStatus(), 500);
  assert.match(ERROR_MESSAGE, /friday-owned-health-500-v1/);
  assert.equal(mode({ mode: "inspect" }), "inspect");
  assert.equal(mode({ mode: "emit-once" }), "emit-once");
  let accessed = false;
  for (const input of [
    null,
    [],
    {},
    { mode: "emit-once", prompt: "not accepted" },
    { mode: "emit-once", [Symbol()]: true },
    {
      get mode() {
        accessed = true;
        return "emit-once";
      },
    },
  ])
    assert.throws(() => mode(input));
  assert.equal(accessed, false);
});
