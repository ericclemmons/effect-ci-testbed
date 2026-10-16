import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

/** Opt-in: fixed compiler preparation downloads its public pinned dependencies.
 * Runs the actual production bundle, not the local esbuild preparation substitute.
 * No Git/source-reader or deployment credential is provided; cannot publish.
 */
test("actual compiled broker prepares its compiler and passes fixed isolation checks", {
  skip: process.env.VERIFY_STATIC_BUILD_BUNDLE !== "1", timeout: 90000,
}, async () => {
  const root = new URL("../", import.meta.url).pathname;
  execFileSync("../../apps/effect-ci/node_modules/.bin/cf", ["build"], {
    cwd: root, timeout: 60000, stdio: "pipe", maxBuffer: 8 * 1024 * 1024,
  });
  const require = createRequire(import.meta.url);
  const plugin = realpathSync(root + "node_modules/@cloudflare/vite-plugin");
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const bundle = root + ".cloudflare/output/v0/workers/default/bundle/";
  const config = JSON.parse(readFileSync(root + ".cloudflare/output/v0/workers/default/worker.config.json", "utf8"));
  const modules: Record<string, unknown> = { "index.js": { type: "esm", contents: readFileSync(bundle + "index.js", "utf8") } };
  for (const [path, entry] of Object.entries(config.manifest.modules) as [string, { type: string }][]) {
    assert.equal(entry.type, "wasm");
    modules[path] = { type: "wasm", contents: new Uint8Array(readFileSync(bundle + path)) };
  }
  modules["probe.js"] = { type: "esm", contents: `
    import{StaticAssetsWorkflow,StaticAssetRevisions}from'./index.js';export{StaticAssetsWorkflow,StaticAssetRevisions};
    export default{async fetch(request,env,ctx){const p=await request.json();
      if(p.start){await ctx.exports.StaticAssetsWorkflow.create({id:'compiled-checks',params:{mode:'build-checks',revision:'${"a".repeat(40)}'}});return Response.json({started:true})}
      return Response.json(await(await ctx.exports.StaticAssetsWorkflow.get('compiled-checks')).status())}}` };
  const runtime = new Miniflare({ workers: [{ config: {
    name: "owned-static-compiled-test", compatibilityDate: config.compatibilityDate, compatibilityFlags: config.compatibilityFlags,
    exports: config.exports, env: { LOADER: { type: "worker-loader" } }, manifest: { mainModule: "probe.js", modules },
  } }] });
  const call = async (body: unknown): Promise<any> => (await runtime.dispatchFetch("https://owned.invalid", {
    method: "POST", body: JSON.stringify(body),
  })).json();
  try {
    await call({ start: true }); let status;
    for (let n = 0; n < 1000; n++) {
      status = await call({}); if (["complete", "errored"].includes(status.status)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(status.status, "complete", JSON.stringify(status.error));
    assert.equal(status.output.tool, "sucrase-3.35.1-typescript");
    assert.ok(Object.values(status.output.checks).every(value => value === true));
    assert.equal(status.output.externalWrites, 0); assert.equal(status.output.cpuEnforcementMeasured, false);
    assert.ok(status.output.parentBundle.bytes > 0);
  } finally { await runtime.dispose(); }
});
