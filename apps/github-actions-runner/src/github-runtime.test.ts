import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("actual workerd GitHub client uses native fetch for repository/job/run authorization", { timeout: 60000 }, async () => {
  const pkg = fileURLToPath(new URL("../", import.meta.url)), require = createRequire(import.meta.url);
  const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const repo = { id: 3, full_name: "fixture/private", private: true };
  const job = { id: 4, runId: 5, attempt: 1, sha: "a".repeat(40) };
  const policy = { enabled: true, appId: 1, installationId: 2, repositoryId: 3,
    repository: "fixture/private", runnerGroupId: 1, lifetimeSeconds: 900 };
  const code = (await build({ stdin: { contents: `
    import {WorkerEntrypoint} from 'cloudflare:workers';
    import {GitHub} from './src/github.ts';
    export default class extends WorkerEntrypoint {
      async fetch(){try{return Response.json({authorized:await new GitHub(${JSON.stringify(policy)},'LOCAL-ONLY').authorize(${JSON.stringify(job)},'LOCAL-TOKEN')});}
      catch(e){return Response.json({name:e.name,error:e.message},{status:500});}}
    }`, resolveDir: pkg, loader: "ts" }, bundle: true, write: false, format: "esm",
    platform: "neutral", target: "esnext", external: ["cloudflare:workers"] })).outputFiles[0].text;
  const manifest = (contents: string) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
  const runtime = new Miniflare({ workers: [
    { config: { name: "github-client", compatibilityDate: "2026-10-07", manifest: manifest(code) },
      dev: { outboundService: { type: "worker", worker: "local-github" } } },
    { config: { name: "local-github", compatibilityDate: "2026-10-07", manifest: manifest(`
      import {WorkerEntrypoint} from 'cloudflare:workers';
      export default class extends WorkerEntrypoint {async fetch(request){
        const path=new URL(request.url).pathname;
        if(path==='/repos/fixture/private')return Response.json(${JSON.stringify(repo)});
        if(path==='/repos/fixture/private/actions/jobs/4')return Response.json(${JSON.stringify({ id: 4, run_id: 5, run_attempt: 1, head_sha: job.sha, status: "queued", conclusion: null, labels: ["effect-ci-cloudflare"] })});
        if(path==='/repos/fixture/private/actions/runs/5')return Response.json(${JSON.stringify({ id: 5, run_attempt: 1, head_sha: job.sha, event: "push", repository: repo, head_repository: repo })});
        return new Response('unexpected LOCAL path',{status:404});
      }}
    `) } },
  ] });
  try {
    const response = await runtime.dispatchFetch("https://local.invalid/");
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.deepEqual(result, { authorized: true });
  } finally { await runtime.dispose(); }
});
