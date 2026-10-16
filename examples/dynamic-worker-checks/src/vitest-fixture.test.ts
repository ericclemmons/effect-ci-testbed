import assert from "node:assert/strict";
import test from "node:test";
import { assertionMode, assertionModes, assertionFixture } from "./vitest-fixture.ts";
test("owned assertion dispatch has only six fixed bounded modes, no actor source or policy", () => {
  for (const mode of assertionModes) { assert.equal(assertionMode({ mode }), mode); assert.ok(assertionFixture(mode).modules["suite.js"]); }
  let accessed = false;
  for (const input of [null, {}, { mode: "passing", modules: {} }, { mode: "passing", cpuMs: 9999 }, { mode: "unknown" },
    { get mode(): never { accessed = true; throw Error("getter"); } }]) assert.throws(() => assertionMode(input));
  assert.equal(accessed, false);
});
