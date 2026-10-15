import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { isPinnedSource, repository, revision } from "./reference.ts";

test("owned public GitLab enrollment rejects mutable/foreign/credential-bearing payloads", () => {
  assert.equal(isPinnedSource({ repository, revision }), true);
  for (const input of [null, {}, { repository, revision: "master" }, { repository, revision: "0".repeat(40) },
    { repository: repository + "?token=foreign", revision }, { repository, revision, token: "foreign" },
    { repository, revision, [Symbol()]: true }]) assert.equal(isPinnedSource(input), false);
  let invoked = false;
  assert.equal(isPinnedSource({ repository, get revision() { invoked = true; return revision; } }), false);
  assert.equal(invoked, false);
});

test("actual local native Workflow rejects mutable input before any container binding exists", { timeout: 30000 }, async () => {
  const pkg = fileURLToPath(new URL("../", import.meta.url)), require = createRequire(import.meta.url);
  const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const code = (await build({ stdin: { resolveDir: pkg, loader: "ts", contents: `
    import {WorkerEntrypoint} from 'cloudflare:workers';
    export {GitLabSourceWorkflow} from './src/worker.ts';
    export default class extends WorkerEntrypoint {async fetch(req){const u=new URL(req.url),w=this.ctx.exports.GitLabSourceWorkflow;
      if(u.pathname==='/start'){const p=await req.json();return Response.json(await w.create({id:p.id,params:p.params}));}
      return Response.json(await(await w.get(u.searchParams.get('id'))).status());}}
  ` }, bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"],
    external: ["node:*", "cloudflare:workers", "cloudflare:workflows"] })).outputFiles[0].text;
  const runtime = new Miniflare({ workers: [{ config: { name: "owned-gitlab-test", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
    exports: { GitLabSourceWorkflow: { type: "workflow", name: "local-owned-gitlab" } },
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: code } } } } }] });
  try {
    for (const [i, params] of [{ repository, revision: "master" }, { repository, revision, actor: "foreign" }].entries()) {
      assert.equal((await runtime.dispatchFetch("https://local.invalid/start", { method: "POST", body: JSON.stringify({ id: "invalid-" + i, params }) })).status, 200);
      let state: any;
      for (let j = 0; j < 100; j++) {
        state = await (await runtime.dispatchFetch(`https://local.invalid/status?id=invalid-${i}`)).json();
        if (state.status === "errored") break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(state.status, "errored");
      // This local Workflow runtime replaces the guard's text with its generic
      // NonRetryableError boundary. The missing container binding ensures that
      // accepting the payload could not quietly proceed into a successful run.
      assert.match(state.error.message, /NonRetryableError/);
    }
  } finally { await runtime.dispose(); }
});

test("owned configuration and image do not import another app/example implementation", async () => {
  const root = new URL("../", import.meta.url);
  for (const file of ["src/worker.ts", "src/reference.ts", "cloudflare.config.ts", "vite.config.ts", ".cloudflare/ci/standalone.ts"])
    assert.doesNotMatch(await readFile(new URL(file, root), "utf8"), /(?:\.\.\/)+(?:apps|examples)\//);
  assert.doesNotMatch(await readFile(new URL("tsconfig.json", root), "utf8"), /"extends"/);
  assert.match(await readFile(new URL("Dockerfile", root), "utf8"), /ca-certificates git python3/);
});
