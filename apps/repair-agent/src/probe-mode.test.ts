import assert from "node:assert/strict";
import test from "node:test";
import { probeMode } from "./probe-mode.ts";
test("unknown dispatches cannot supply a model, prompt, source or new budget", () => {
  for (const payload of [
    null,
    [],
    {},
    { mode: "other" },
    { mode: "proposal", prompt: "secret" },
    { mode: "proposal", model: "other" },
    { mode: "proposal", source: "other" },
    { mode: "inspect", budget: 700 },
  ])
    assert.throws(() => probeMode("owned", payload), /Fixed mode/);
  assert.throws(() => probeMode("../other", { mode: "inspect" }), /Fixed mode/);
  assert.equal(probeMode("owned", { mode: "inspect" }), "inspect");
  assert.equal(probeMode("owned", { mode: "proposal" }), "proposal");
});
test("accessors and extra symbol fields cannot execute while validating dispatch", () => {
  let reads = 0;
  assert.throws(
    () =>
      probeMode("owned", {
        get mode() {
          reads++;
          return "proposal";
        },
      }),
    /Fixed mode/,
  );
  assert.equal(reads, 0);
  assert.throws(
    () => probeMode("owned", { mode: "proposal", [Symbol("extra")]: true }),
    /Fixed mode/,
  );
});
