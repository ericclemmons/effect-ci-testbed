import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("read-only source inspection copies private RPC receipt without admission, dispatch or reset", async () => {
  const pkg = fileURLToPath(new URL("../", import.meta.url));
  const require = createRequire(import.meta.url);
  const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const code = (await build({ entryPoints: [join(pkg, "fixtures/local.ts")], bundle: true,
    write: false, format: "esm", platform: "neutral", external: ["cloudflare:workers", "cloudflare:workflows"],
  })).outputFiles[0].text;
  const claim = { emission: "LOCAL-source", version: "11111111-1111-1111-1111-111111111111",
    currentVersion: "22222222-2222-2222-2222-222222222222", fixtureDigest: "a".repeat(64), claimedAt: 123 };
  const manifest = (contents: string) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
  const runtime = new Miniflare({ workers: [
    { config: { name: "local-inspection", compatibilityDate: "2026-10-07",
      env: { PUBLIC_SOURCE: { type: "worker", worker: "local-source" } },
      exports: {}, manifest: manifest(code) } },
    { config: { name: "local-source", compatibilityDate: "2026-10-07", manifest: manifest(`
      import {WorkerEntrypoint} from 'cloudflare:workers';
      export default class extends WorkerEntrypoint { readPublicClaim(){ return ${JSON.stringify(claim)}; } }
    `) } },
  ] });
  try {
    const r = await runtime.dispatchFetch("https://owned.invalid/local-inspection", {
      method: "POST", body: JSON.stringify({ mode: "public-source" }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { result: { producer: claim, readOnly: true, inferenceCalled: false },
      steps: ["notification:public-source"], localOnly: true });
    assert.equal((await runtime.dispatchFetch("https://owned.invalid/notifications")).status, 405);
    assert.equal((await runtime.dispatchFetch("https://owned.invalid/public-source")).status, 404);
  } finally { await runtime.dispose(); }
});
