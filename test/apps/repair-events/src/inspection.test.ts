import assert from "node:assert/strict";
import test from "node:test";
import { inspection } from "./inspection.ts";
test("inspection accepts only owned modes and descriptor-safe capture digests", () => {
  const digest = "a".repeat(64);
  assert.deepEqual(inspection({ mode: "inventory" }), { mode: "inventory" });
  assert.deepEqual(inspection({ mode: "public-source" }), { mode: "public-source" });
  assert.deepEqual(inspection({ mode: "read", digest }), {
    mode: "read",
    digest,
  });
  let accessed = false;
  for (const value of [
    null,
    [],
    {},
    { mode: "read" },
    { mode: "read", digest: "https://untrusted.invalid/" },
    { mode: "read", digest, passed: true },
    { mode: "inventory", [Symbol()]: true },
    { mode: "public-source", version: "actor-selected" },
    { mode: "public-source", digest },
    {
      get mode() {
        accessed = true;
        return "inventory";
      },
    },
    {
      mode: "read",
      get digest() {
        accessed = true;
        return digest;
      },
    },
  ])
    assert.throws(() => inspection(value));
  assert.equal(accessed, false);
});
