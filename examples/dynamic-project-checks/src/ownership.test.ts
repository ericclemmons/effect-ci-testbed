import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fixedMode } from "./mode.ts";
test("project and hostile fixtures reject caller-supplied modules and authority", () => {
  fixedMode({ mode: "fixture" }, "fixture"); fixedMode({ mode: "verify-boundaries" }, "verify-boundaries");
  for (const p of [null, {}, { mode: "fixture", modules: {} }, { mode: "verify-boundaries" }, { mode: "fixture", [Symbol()]: true }]) assert.throws(() => fixedMode(p, "fixture"));
  let invoked = false; assert.throws(() => fixedMode({ get mode() { invoked = true; return "fixture"; } }, "fixture")); assert.equal(invoked, false);
});
test("project owns its modules, closed hostile fixtures and WorkerLoader-only configuration", async () => {
  const root = new URL("../", import.meta.url);
  for (const file of ["src/worker.ts", "src/boundaries.ts", "cloudflare.config.ts", "vite.config.ts"]) assert.doesNotMatch(await readFile(new URL(file, root), "utf8"), /(?:\.\.\/)+(?:apps|examples)\//);
  const config = await readFile(new URL("cloudflare.config.ts", root), "utf8");
  assert.match(config, /LOADER: bindings.workerLoader\(\)/); assert.doesNotMatch(config, /defineContainer|durableObject|dockerfile/);
  assert.doesNotMatch(await readFile(new URL("tsconfig.json", root), "utf8"), /"extends"/);
  const code = await readFile(new URL("src/worker.ts", root), "utf8");
  assert.match(code, /app\/index.js\?raw/); assert.match(code, /app\/lib.js\?raw/);
});
