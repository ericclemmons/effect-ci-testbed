import assert from "node:assert/strict";
import test from "node:test";
import { fixtureMode } from "./mode.ts";
test("only fixed owned fixture modes are admitted, with no destination or code input", () => {
  for (const mode of ["success", "business-failure", "provider-timeout", "observer-success", "observer-business-failure"] as const)
    assert.equal(fixtureMode({ mode }), mode);
  let invoked = 0;
  for (const input of [null, [], {}, { mode: "reset" }, { mode: "success", destination: "anything" },
    { get mode() { invoked++; return "success"; } }]) assert.throws(() => fixtureMode(input));
  assert.equal(invoked, 0);
});
