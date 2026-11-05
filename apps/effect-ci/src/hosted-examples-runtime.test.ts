import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { taskCachePaths } from "@effect-ci-testbed/ci/task-cache";
import { hostedExamples, projectRoot } from "./hosted-examples.ts";

const repository = new URL("../../../", import.meta.url);
const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "pnpm-workspace.yaml"];

test(
  "a signed check suite runs each hosted example beside monorepo and reports Cloudflare / <recipe>",
  { timeout: 180_000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = realpathSync(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    // The fake container serves the committed example files the package manager probes.
    const files: Record<string, string> = {};
    for (const example of hostedExamples) {
      for (const directory of [projectRoot(example), `${projectRoot(example)}/app`]) {
        for (const name of ["package.json", ...lockfiles]) {
          const path = new URL(`${directory}/${name}`, repository);
          if (existsSync(path)) files[`${directory}/${name}`] = name === "package.json" ? readFileSync(path, "utf8") : "";
        }
      }
    }
    // Default cache discovery runs node in the container; compute it from the real checkout.
    const discovered: Record<string, ReadonlyArray<string>> = {};
    for (const example of hostedExamples)
      if (example.cache === "discover") discovered[projectRoot(example)] = taskCachePaths(new URL(".", repository).pathname, projectRoot(example));
    // Shard commands write reports that the join reads back; the fake does not run node.
    for (const recipe of ["test-splitting", "timing-aware-splitting"]) {
      for (const index of [0, 1]) {
        files[`examples/${recipe}/app/reports/shard-${index}.json`] = JSON.stringify({ index, total: 2, history: {},
          results: [{ file: `tests/${index}.test.mjs`, durationMs: 1, passed: true }] });
      }
    }
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
      import{DurableObject}from'cloudflare:workers';
      import*as CI from'@effect-ci-testbed/ci';
      import*as GitHubCloudflare from'@effect-ci-testbed/github-cloudflare';
      import{monorepoGitHubRun}from'./monorepo-policy.ts';
      import{hostedExampleRuns}from'./hosted-examples.ts';
      export{ExampleCIWorkflow}from'./example-workflow.ts';
      const checks=[],commands=[],stops=[],checkouts=[],restores=[];let nextCheck=0;
      const relative=path=>path.replace(/^\\/workspace\\/repository\\/?/,'');
      globalThis.fetch=async(input,init={})=>{
        const url=new URL(String(input));if(url.origin!=='https://api.github.com')throw Error('Unexpected destination '+url);
        if(url.pathname==='/app/installations/165265172/access_tokens')return Response.json({token:'fixture-installation-token'},{status:201});
        const body=init.body?JSON.parse(init.body):{};
        if(init.method==='POST'&&url.pathname==='/repos/ericclemmons/effect-ci-testbed/check-runs'){
          const id=++nextCheck;checks.push({id,name:body.name,status:body.status,conclusion:body.conclusion,op:'create'});
          return Response.json({id,html_url:'https://github.com/runs/'+id},{status:201});
        }
        const update=url.pathname.match(/^\\/repos\\/ericclemmons\\/effect-ci-testbed\\/check-runs\\/(\\d+)$/);
        if(init.method==='PATCH'&&update){const id=Number(update[1]);checks.push({id,name:body.name,status:body.status,conclusion:body.conclusion,op:'update'});return Response.json({id,html_url:'https://github.com/runs/'+id});}
        throw Error('Unexpected GitHub operation '+init.method+' '+url.pathname);
      };
      export class WorkspaceContainer extends DurableObject{
        async checkout(repository,revision,directory,options,token){checkouts.push({repository,revision,directory,image:options?.image,instance:options?.instance,token:token==='fixture-installation-token'});}
        async execute(command,cwd,stepId,revision,cachePaths,cacheRoot,options){
          commands.push({command,cwd:relative(cwd),stepId,container:this.ctx.id.name,image:options?.image,instance:options?.instance,loginShell:options?.loginShell,cachePaths:cachePaths??[]});
          return {exitCode:this.env.FAIL_STEPS.includes(relative(cwd)+':'+stepId)?1:0,stdout:'',stderr:''};
        }
        async exists(path,cwd){return path==='.'||relative(cwd+'/'+path) in this.env.FILES;}
        async readFile(path,cwd){return this.env.FILES[relative(cwd+'/'+path)];}
        async checkpoint(name){return {id:'snapshot-'+name+'@'+this.ctx.id.name,size:1};}
        async restore(snapshot){restores.push({container:this.ctx.id.name,snapshot:snapshot.id});}
        // Platform image digest and a cache store, as the real WorkspaceContainer keeps them.
        async getImageIdentity(options){return options?.image==='repository'?'sha256:'+'1'.repeat(64):undefined;}
        async taskCachePaths(cwd,root){return this.env.CACHE_PATHS[root]??[];}
        async getCachedSnapshot(key){return this.ctx.storage.get('cache:'+key);}
        async putCachedSnapshot(key,snapshot){await this.ctx.storage.put('cache:'+key,snapshot);}
        async stop(){stops.push(this.ctx.id.name);}
      }
      // Stand-in for the root workflow: the real one needs Docker and deploy credentials.
      export const EffectCIWorkflow=GitHubCloudflare.workflowEntrypoint(
        CI.workflow('monorepo',function*(){yield*CI.action('check',()=>function*(){return 'ok';})();}),
        {cache:false,notificationChannels:()=>({})});
      const ci=GitHubCloudflare.worker({githubRun:monorepoGitHubRun,githubCheckSuiteRuns:hostedExampleRuns});
      export default{async fetch(request,env,ctx){
        if(new URL(request.url).pathname==='/webhooks/github')return ci.fetch(request,env,ctx);
        const input=await request.json();
        if(input.op==='status')return Response.json(await(await ctx.exports[input.binding].get(input.id)).status());
        if(input.op==='reset'){nextCheck=0;checks.length=0;commands.length=0;stops.length=0;checkouts.length=0;restores.length=0;return Response.json({});}
        return Response.json({checks,commands,stops,checkouts,restores});
      }};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      conditions: ["workerd", "import"],
      external: ["cloudflare:workers", "node:*"],
    });
    // optional-checks' format script always exits 1 by design.
    const runtime = (failSteps: ReadonlyArray<string> = []) => new Miniflare({
      workers: [{
        config: {
          name: "hosted-examples-test",
          compatibilityDate: "2026-10-07",
          compatibilityFlags: ["nodejs_compat"],
          manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } } },
          exports: {
            WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
            EffectCIWorkflow: { type: "workflow", name: "effect-ci-github-cloudflare" },
            ExampleCIWorkflow: { type: "workflow", name: "effect-ci-examples" },
          },
          env: {
            GITHUB_APP_ID: { type: "text", value: "1234" },
            GITHUB_PRIVATE_KEY: { type: "text", value: privateKey },
            GITHUB_WEBHOOK_SECRET: { type: "text", value: "local-fixture" },
            FILES: { type: "json", value: files },
            CACHE_PATHS: { type: "json", value: discovered },
            FAIL_STEPS: { type: "json", value: ["examples/optional-checks:format", ...failSteps] },
          },
        },
      }],
    });
    type Run = { delivery: string; statuses: Record<string, any>; checks: any[]; commands: any[]; stops: string[]; checkouts: any[]; restores: any[] };
    // Each run is a later push to the same host: durable state such as caches carries over.
    const scenario = async (failSteps?: ReadonlyArray<string>, runs = 1): Promise<Run[]> => {
      const mf = runtime(failSteps);
      try {
        const call = async (input: unknown): Promise<any> =>
          (await mf.dispatchFetch("https://host.invalid/", { method: "POST", body: JSON.stringify(input) })).json();
        const results: Run[] = [];
        for (let run = 1; run <= runs; run++) {
          await call({ op: "reset" });
          const delivery = `11111111-2222-3333-4444-55555555555${run}`;
          const body = JSON.stringify({
            action: "requested",
            check_suite: { app: { id: 1234 }, head_branch: "main", head_sha: "a".repeat(40) },
            installation: { id: 165265172 },
            repository: { clone_url: "https://github.com/ericclemmons/effect-ci-testbed.git", full_name: "ericclemmons/effect-ci-testbed" },
          });
          const webhook = await mf.dispatchFetch("https://host.invalid/webhooks/github", { method: "POST", body, headers: {
            "x-github-event": "check_suite", "x-github-delivery": delivery,
            "x-hub-signature-256": "sha256=" + createHmac("sha256", "local-fixture").update(body).digest("hex"),
          } });
          const accepted = await webhook.json() as any;
          assert.equal(webhook.status, 202, JSON.stringify(accepted));
          assert.equal(accepted.instanceId, delivery);
          assert.deepEqual(accepted.additional, hostedExamples.map(({ recipe }) =>
            ({ key: recipe, accepted: true, instanceId: `${delivery}-${recipe}` })));
          const instances = [["EffectCIWorkflow", delivery],
            ...hostedExamples.map(({ recipe }) => ["ExampleCIWorkflow", `${delivery}-${recipe}`])];
          const statuses: Record<string, any> = {};
          for (const [binding, id] of instances) {
            for (let attempt = 0; attempt < 500; attempt++) {
              statuses[id!] = await call({ op: "status", binding, id });
              if (["complete", "errored"].includes(statuses[id!].status)) break;
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          }
          results.push({ delivery, statuses, ...(await call({})) });
        }
        return results;
      } finally { await mf.dispose(); }
    };
    const summary = (checks: any[], name: string) => {
      const created = checks.find(check => check.op === "create" && check.name === name);
      assert.ok(created, `${name} was created`);
      return checks.filter(check => check.id === created.id).at(-1);
    };

    const [first, passed] = await scenario(undefined, 2) as [Run, Run];
    for (const [id, status] of [...Object.entries(first.statuses), ...Object.entries(passed.statuses)])
      assert.equal(status.status, "complete", `${id}: ${JSON.stringify(status)}`);
    assert.deepEqual(summary(passed.checks, "Effect CI / Cloudflare"),
      { id: 1, name: "Cloudflare / monorepo", status: "completed", conclusion: "success", op: "update" });
    for (const { recipe } of hostedExamples) {
      const final = summary(passed.checks, `Cloudflare / ${recipe}`);
      assert.equal(final.name, `Cloudflare / ${recipe}`);
      assert.equal(final.conclusion, "success", recipe);
      assert.ok(passed.checks.some(check => check.name?.startsWith(`Cloudflare / ${recipe} / `)), `${recipe} reports its steps`);
    }
    // node-npm runs its own scripts from its directory in the small unprivileged image.
    const npm = passed.commands.filter(command => command.cwd === "examples/node-npm");
    assert.deepEqual(npm.map(command => command.stepId).sort(), ["build", "install", "lint", "test"]);
    assert.match(npm.find(command => command.stepId === "install")!.command, /npm ci/);
    assert.ok(passed.commands.length > 0);
    for (const command of passed.commands)
      assert.deepEqual([command.image, command.instance, command.loginShell], ["repository", "standard-1", false]);
    assert.match(passed.commands.find(command => command.cwd === "examples/node-pnpm" && command.stepId === "install")!.command,
      /^pnpm --ignore-workspace install/);
    // The demo row runs the walkthrough project, not examples/demo, under its own check name.
    const demo = passed.commands.filter(command => command.cwd === "test/fixtures/demo");
    assert.match(demo.find(command => command.stepId === "install")!.command, /npm ci/);
    assert.deepEqual(demo.filter(command => command.stepId !== "install").map(command => command.command).sort(),
      ["build", "check", "lint", "test", "typecheck"].map(name => `npm run "${name}"`));
    // Every matrix cell runs from the app directory.
    assert.deepEqual(passed.commands.filter(command => command.cwd === "examples/matrix/app").map(command => command.command).sort(),
      ["node verify.mjs de-DE EUR", "node verify.mjs de-DE USD", "node verify.mjs en-US EUR", "node verify.mjs en-US USD"]);
    // Each shard runs in its own step; the join receives both shard reports.
    const splitting = passed.commands.filter(command => command.cwd === "examples/test-splitting/app");
    assert.deepEqual(splitting.map(command => command.stepId).sort(), ["test shard 0/2", "test shard 1/2", "verify shard reports"]);
    assert.match(splitting.find(command => command.stepId === "verify shard reports")!.command, /"index":0.*"index":1/);
    // A failing optional check is neutral and does not fail its example.
    assert.equal(summary(passed.checks, "Cloudflare / optional-checks").conclusion, "success");
    assert.equal(passed.checks.filter(check => /^Cloudflare \/ optional-checks \/ \w+\. format \(optional\)$/.test(check.name)).at(-1)?.conclusion,
      "neutral", JSON.stringify(passed.checks.filter(check => check.name?.startsWith("Cloudflare / optional-checks"))));
    // main deploys conditional-deploy; its condition is the recipe, not a skip.
    assert.deepEqual(passed.commands.filter(command => command.cwd === "examples/conditional-deploy").map(command => command.command),
      ["echo deploy"]);
    // Parallel branches of snapshot-fanout write the same file in separate containers.
    const fanout = passed.commands.filter(command => command.cwd === "examples/snapshot-fanout/app" && command.stepId !== "prepare");
    assert.deepEqual(fanout.map(command => command.container).sort(),
      [`${passed.delivery}-snapshot-fanout:step=left`, `${passed.delivery}-snapshot-fanout:step=right`]);
    // The consumer restores the published artifact before reading it.
    assert.ok(passed.restores.some(restore => restore.container.startsWith(`${passed.delivery}-portable-artifacts`) &&
      restore.snapshot.startsWith("snapshot-artifact:worker@")), JSON.stringify(passed.restores));
    assert.ok(passed.commands.some(command => command.cwd === "examples/portable-artifacts" && command.command === "test -f dist/worker.js"));
    assert.ok(passed.checkouts.every(checkout => checkout.token && checkout.revision === "a".repeat(40)));
    // Each example stops its own workspace and per-step containers.
    assert.ok(passed.stops.includes(`${passed.delivery}-node-npm`));
    assert.ok(passed.stops.includes(`${passed.delivery}-node-npm:step=build`), JSON.stringify(passed.stops));

    // Cache recipes run with their own policy; the next push restores what the previous run of
    // the same recipe stored. Other examples keep cache transport off and never restore.
    const cached = hostedExamples.filter(example => example.cache);
    assert.deepEqual(cached.map(({ recipe }) => recipe), ["package-manager-cache", "cache-policy", "vite-plus-cache", "turborepo-cache"]);
    for (const example of cached) {
      const { recipe } = example;
      const paths = example.cache === "discover" ? discovered[projectRoot(example)] : example.cache!.paths;
      assert.ok(paths!.length > 0, recipe);
      for (const run of [first, passed]) {
        const commands = run.commands.filter(command => command.container.startsWith(`${run.delivery}-${recipe}`));
        assert.ok(commands.length > 0, recipe);
        for (const command of commands) assert.deepEqual(command.cachePaths, paths, `${recipe}: ${command.command}`);
      }
      assert.ok(!first.restores.some(restore => restore.container === `${first.delivery}-${recipe}`), `${recipe}: first run has no cache`);
      const restored = passed.restores.filter(restore => restore.container === `${passed.delivery}-${recipe}`);
      assert.equal(restored.length, 1, `${recipe}: ${JSON.stringify(passed.restores)}`);
      assert.match(restored[0].snapshot, new RegExp(`@${first.delivery}-${recipe}(:|$)`), recipe);
    }
    for (const { recipe } of hostedExamples.filter(example => !example.cache)) {
      assert.ok(!passed.restores.some(restore => restore.container === `${passed.delivery}-${recipe}`), recipe);
      for (const command of passed.commands.filter(command => command.container.startsWith(`${passed.delivery}-${recipe}`)))
        assert.deepEqual(command.cachePaths, [], recipe);
    }
    // Default discovery finds each tool's task cache in the nested app.
    assert.ok(discovered["examples/vite-plus-cache"]!.includes("examples/vite-plus-cache/app/node_modules/.vite/task-cache"));
    assert.ok(discovered["examples/turborepo-cache"]!.includes("examples/turborepo-cache/app/.turbo/cache"));

    // A failing example reports only its own failure; monorepo and the other examples still pass.
    const [failed] = await scenario(["examples/node-npm:test"]) as [Run];
    assert.equal(failed.statuses[failed.delivery].status, "complete");
    assert.equal(summary(failed.checks, "Effect CI / Cloudflare").conclusion, "success");
    assert.equal(summary(failed.checks, "Cloudflare / node-npm").conclusion, "failure");
    assert.equal(summary(failed.checks, "Cloudflare / node-pnpm").conclusion, "success");
    assert.ok(failed.stops.includes(`${failed.delivery}-node-npm`), "cleanup still runs after a failure");
  },
);
