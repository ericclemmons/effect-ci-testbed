import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import { deploymentAPI } from "./release-manager.ts"

const require = createRequire(import.meta.url)
const { Miniflare } = require(require.resolve("miniflare", {
  paths: [realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url))],
}))

test("Workers runtime accepts manual redirect rejection without credentials or network", async () => {
  const script = `export default {async fetch(request) {
    if (request.method === "POST") {
      const {url, init} = await request.json();
      new Request(url, init);
      return Response.json({success:true,result:{deployments:[{
        id:"00000000-0000-0000-0000-000000000001",
        versions:[{version_id:"00000000-0000-0000-0000-000000000002",percentage:100}]
      }]}});
    }
    const results = {};
    for (const mode of ["error", "manual"]) {
      try { new Request("https://example.com", {redirect: mode}); results[mode] = "accepted"; }
      catch (e) { results[mode] = e.message; }
    }
    return Response.json(results);
  }}`
  const runtime = new Miniflare({ workers: [{ config: {
    name: "transport-probe", compatibilityDate: "2026-10-07",
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: script } } },
  } }] })
  try {
    const modes = await (await runtime.dispatchFetch("https://probe.invalid")).json()
    assert.equal(modes.manual, "accepted")
    assert.match(modes.error, /Invalid redirect value/)
    // Exercise the broker's actual RequestInit against workerd, not Node's fetch.
    const api = deploymentAPI(() => "not-a-real-token", ((url, init) => runtime.dispatchFetch("https://probe.invalid", {
      method: "POST", body: JSON.stringify({ url: String(url), init: { method: init?.method, redirect: init?.redirect } }),
    })) as typeof fetch)
    assert.equal((await api.latest()).id, "00000000-0000-0000-0000-000000000001")
  } finally { await runtime.dispose() }
})
