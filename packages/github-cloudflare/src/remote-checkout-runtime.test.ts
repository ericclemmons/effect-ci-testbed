import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

test(
  "actual remote Workflow borrows scoped checkout credentials only when opted in, including cache source reads",
  { timeout: 30_000 },
  async () => {
    const require = createRequire(import.meta.url);
    const plugin = realpathSync(
      new URL("../../../apps/effect-ci/node_modules/@cloudflare/vite-plugin", import.meta.url),
    );
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const bundle = await build({
      stdin: {
        resolveDir: new URL(".", import.meta.url).pathname,
        loader: "ts",
        contents: `
      import{DurableObject}from'cloudflare:workers';
      import*as CI from'@effect-ci-testbed/ci';
      import{workflowEntrypoint}from'./index.ts';
      const events=[];
      globalThis.fetch=async(input,init)=>{
        const url=new URL(String(input));if(url.origin!=='https://api.github.com')throw Error('Unexpected destination');
        if(init.redirect!=='manual')throw Error('Redirects enabled');events.push(url.pathname);
        if(url.pathname==='/repos/acme/private/installation')return Response.json({id:101,app_id:1234});
        if(url.pathname==='/app/installations/101/access_tokens'){
          if(JSON.stringify(JSON.parse(init.body))!==JSON.stringify({repositories:['private'],permissions:{contents:'read'}}))throw Error('Wrong scope');
          return Response.json({token:'fixture_checkout_token',permissions:{contents:'read'}},{status:201});
        }
        if(url.pathname==='/installation/token'&&init.method==='DELETE')return new Response(null,{status:204});
        throw Error('Unexpected API operation');
      };
      export class WorkspaceContainer extends DurableObject{
        async getImageIdentity(){return 'sha256:'+ 'a'.repeat(64);}
        async checkout(repository,revision,directory,options,token){events.push(token==='fixture_checkout_token'?'authenticated-checkout':token===undefined?'anonymous-checkout':'wrong-credential');}
        async checkpoint(){return{id:'fixture-snapshot',size:1};}
        async getCachedSnapshot(){return undefined;}
        async putCachedSnapshot(){}
      }
      const checkout=CI.action('checkout',()=>function*(){return yield*(yield*CI.Source).checkout();});
      const program=CI.workflow('private-source',function*(){yield*checkout();return'done';});
      export const Enabled=workflowEntrypoint(program,{cache:false,remoteGitHubCheckout:true});
      export const Cached=workflowEntrypoint(program,{cache:{key:'fixture',keyFiles:[],paths:[]},remoteGitHubCheckout:true});
      export const Disabled=workflowEntrypoint(program,{cache:false});
      export default{async fetch(request,env,ctx){const input=await request.json();
        if(input.op==='start'){events.length=0;await ctx.exports[input.name].create({id:input.id,params:{trigger:'remote',repository:'https://github.com/acme/private.git',revision:'a'.repeat(40),installationId:999}});return Response.json({started:true});}
        if(input.op==='status')return Response.json(await(await ctx.exports[input.name].get(input.id)).status());
        return Response.json(events);
      }};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      conditions: ["workerd", "import"],
      external: ["cloudflare:workers", "node:*"],
    });
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "remote-checkout-test",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: bundle.outputFiles[0].text } },
            },
            exports: {
              WorkspaceContainer: { type: "durable-object", storage: "sqlite" },
              ...Object.fromEntries(
                ["Enabled", "Cached", "Disabled"].map((name) => [
                  name,
                  { type: "workflow", name: name.toLowerCase() },
                ]),
              ),
            },
            env: {
              GITHUB_APP_ID: { type: "text", value: "1234" },
              GITHUB_PRIVATE_KEY: { type: "text", value: privateKey },
            },
          },
        },
      ],
    });
    const call = async (input: unknown): Promise<any> =>
      (
        await runtime.dispatchFetch("https://fixture.invalid", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).json();
    try {
      for (const name of ["Enabled", "Cached", "Disabled"]) {
        const id = name.toLowerCase();
        await call({ op: "start", name, id });
        let status: any;
        for (let n = 0; n < 200; n++) {
          status = await call({ op: "status", name, id });
          if (["complete", "errored"].includes(status.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(status.status, "complete", JSON.stringify(status));
        assert.doesNotMatch(
          JSON.stringify(status),
          /fixture_checkout_token|BEGIN PRIVATE KEY|Bearer /,
        );
        const events = await call({});
        const borrowed = [
          "/repos/acme/private/installation",
          "/app/installations/101/access_tokens",
          "authenticated-checkout",
          "/installation/token",
        ];
        assert.deepEqual(
          events,
          name === "Disabled"
            ? ["anonymous-checkout"]
            : name === "Cached"
              ? [...borrowed, ...borrowed]
              : borrowed,
        );
      }
    } finally {
      await runtime.dispose();
    }
  },
);
