import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { hostedExamples, projectRoot } from "./hosted-examples.ts";

const repository = new URL("../../../", import.meta.url);
const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "pnpm-workspace.yaml"];

test(
  "a signed check suite runs each hosted example beside monorepo and reports Cloudflare / <recipe>",
  { timeout: 60_000 },
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
      for (const name of ["package.json", ...lockfiles]) {
        const path = new URL(`${projectRoot(example)}/${name}`, repository);
        if (existsSync(path)) files[`${projectRoot(example)}/${name}`] = name === "package.json" ? readFileSync(path, "utf8") : "";
      }
    }
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
      const checks=[],commands=[],stops=[],checkouts=[];let nextCheck=0;
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
          commands.push({command,cwd:relative(cwd),stepId,image:options?.image,instance:options?.instance,loginShell:options?.loginShell});
          return {exitCode:this.env.FAIL_STEPS.includes(relative(cwd)+':'+stepId)?1:0,stdout:'',stderr:''};
        }
        async exists(path,cwd){return relative(cwd+'/'+path) in this.env.FILES;}
        async readFile(path,cwd){return this.env.FILES[relative(cwd+'/'+path)];}
        async checkpoint(name){return {id:'snapshot-'+name,size:1};}
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
        if(input.op==='reset'){checks.length=0;commands.length=0;stops.length=0;checkouts.length=0;return Response.json({});}
        return Response.json({checks,commands,stops,checkouts});
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
            FAIL_STEPS: { type: "json", value: ["examples/optional-checks:format", ...failSteps] },
          },
        },
      }],
    });
    const scenario = async (failSteps?: ReadonlyArray<string>) => {
      const mf = runtime(failSteps);
      try {
        const call = async (input: unknown): Promise<any> =>
          (await mf.dispatchFetch("https://host.invalid/", { method: "POST", body: JSON.stringify(input) })).json();
        const delivery = "11111111-2222-3333-4444-555555555555";
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
        return { delivery, statuses, ...(await call({})) as { checks: any[]; commands: any[]; stops: string[]; checkouts: any[] } };
      } finally { await mf.dispose(); }
    };
    const summary = (checks: any[], name: string) => {
      const created = checks.find(check => check.op === "create" && check.name === name);
      assert.ok(created, `${name} was created`);
      return checks.filter(check => check.id === created.id).at(-1);
    };

    const passed = await scenario();
    for (const [id, status] of Object.entries(passed.statuses))
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
    assert.ok(passed.checkouts.every(checkout => checkout.token && checkout.revision === "a".repeat(40)));
    // Each example stops its own workspace and per-step containers.
    assert.ok(passed.stops.includes(`${passed.delivery}-node-npm`));
    assert.ok(passed.stops.includes(`${passed.delivery}-node-npm:step=build`), JSON.stringify(passed.stops));

    // A failing example reports only its own failure; monorepo and the other examples still pass.
    const failed = await scenario(["examples/node-npm:test"]);
    assert.equal(failed.statuses[failed.delivery].status, "complete");
    assert.equal(summary(failed.checks, "Effect CI / Cloudflare").conclusion, "success");
    assert.equal(summary(failed.checks, "Cloudflare / node-npm").conclusion, "failure");
    assert.equal(summary(failed.checks, "Cloudflare / node-pnpm").conclusion, "success");
    assert.ok(failed.stops.includes(`${failed.delivery}-node-npm`), "cleanup still runs after a failure");
  },
);
