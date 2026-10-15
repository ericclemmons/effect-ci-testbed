import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fixtureMode } from "./mode.ts";
test("formatter accepts only owned data fixtures, never actor code or capabilities", () => {
  assert.equal(fixtureMode({ mode: "formatted" }), "formatted");
  assert.equal(fixtureMode({ mode: "unformatted" }), "unformatted");
  for (const p of [null, {}, { mode: "formatted", source: "foreign" }, { mode: "other" }, { mode: "formatted", [Symbol()]: 1 }]) assert.throws(() => fixtureMode(p));
  let invoked = false; assert.throws(() => fixtureMode({ get mode() { invoked = true; return "formatted"; } })); assert.equal(invoked, false);
});
test("formatter owns WorkerLoader configuration and fixture source without Containers", async () => {
  const root = new URL("../", import.meta.url);
  for (const file of ["src/worker.ts", "cloudflare.config.ts", "vite.config.ts"]) assert.doesNotMatch(await readFile(new URL(file, root), "utf8"), /(?:\.\.\/)+(?:apps|examples)\//);
  const config = await readFile(new URL("cloudflare.config.ts", root), "utf8");
  assert.match(config, /LOADER: bindings.workerLoader\(\)/); assert.doesNotMatch(config, /defineContainer|durableObject|dockerfile/);
  assert.doesNotMatch(await readFile(new URL("tsconfig.json", root), "utf8"), /"extends"/);
  assert.match(await readFile(new URL("src/worker.ts", root), "utf8"), /app\/src\/index.ts\?raw/);
});
