import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";

const require = createRequire(import.meta.url);
const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));

test("real Node HTTPS needs the additional interception CA, with verification still enabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-ci-ca-test-"));
  const key = join(directory, "key.pem"), certificate = join(directory, "ca.pem");
  let server: ReturnType<typeof createServer> | undefined;
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-keyout", key, "-out", certificate, "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
    server = createServer({ key: await readFile(key), cert: await readFile(certificate) }, (_request, response) => response.end("trusted"));
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const probe = (trust: boolean) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e",
        `try {console.log(await (await fetch('https://127.0.0.1:${address.port}')).text())} catch(error) {console.error(error.cause?.code);process.exitCode=1}`],
      { env: { ...(trust ? { NODE_EXTRA_CA_CERTS: certificate } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", bytes => output += bytes);
      child.stderr.on("data", bytes => output += bytes);
      child.on("error", reject);
      child.on("close", code => resolve({ code, output }));
    });
    const untrusted = await probe(false);
    assert.equal(untrusted.code, 1);
    assert.match(untrusted.output, /SELF_SIGNED_CERT|CERTIFICATE_VERIFY_FAILED/);
    assert.deepEqual(await probe(true), { code: 0, output: "trusted\n" });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("main deployment commands receive only dummy credentials; real credentials remain outside the simulated process backend", async () => {
  const output = await build({
    stdin: { resolveDir: new URL(".", import.meta.url).pathname, loader: "ts", contents: `
      import {WorkspaceContainer} from './monorepo-container.ts';
      import {DurableObject} from 'cloudflare:workers';
      export class Probe extends DurableObject {
        calls;
        host;
        constructor(ctx,env){
          const calls=[];
          const container={running:true,interceptOutboundHttps:async(host)=>{calls.push({intercept:host});},destroy:async()=>{container.running=false;},exec:async(command,options)=>{
            calls.push({command:command.at(-1),authorized:!!options?.env?.CLOUDFLARE_API_TOKEN,network:options?.env?.WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST,ca:options?.env?.NODE_EXTRA_CA_CERTS});
            const trustFailure=command.at(-1)?.includes('update-ca-certificates') && await ctx.storage.get('trustFailure');
            return {output:async()=>({exitCode:trustFailure?1:0,stdout:new TextEncoder().encode(options?.env?.CLOUDFLARE_API_TOKEN??'ok'),stderr:new Uint8Array()})};
          }};
          super(ctx,env);
          this.host=Object.create(WorkspaceContainer.prototype);
          Object.defineProperties(this.host,{
            ctx:{value:{storage:ctx.storage,container,id:ctx.id,exports:{CloudflareDeploymentOutbound:()=>({})}}},env:{value:env},
            queue:{value:Promise.resolve(),writable:true},
            materialize:{value:async()=>{}},
          });
          this.calls=calls;
        }
        execute(...args){return this.host.execute(...args);}
        stop(){return this.host.stop();}
        allowMainDeployment(revision){return this.host.allowMainDeployment(revision);}
        async failTrust(){await this.ctx.storage.put('trustFailure',true);}
        async inspect(){return {calls:this.calls,stored:[...await this.ctx.storage.list()]};}
      }
      export default {async fetch(request,env,ctx){
        const stub=ctx.exports.Probe.getByName('deployment-test');
        const command='./node_modules/.bin/cf deploy --prebuilt',cwd='/workspace/repository/apps/effect-ci';
        const denied=await stub.execute(command,cwd,'deploy effect-ci');
        await stub.allowMainDeployment('a'.repeat(40));
        await stub.execute('pnpm check','/workspace/repository','check');
        await stub.execute('pnpm build',cwd,'deploy effect-ci');
        await stub.execute(command,cwd,'foreign-action');
        const published=await stub.execute(command,cwd,'deploy effect-ci');
        await stub.execute(command,'/workspace/repository/test/apps/repair-ai','deploy repair-ai');
        const before=await stub.inspect();
        await stub.failTrust();
        let trustError;
        try {await stub.execute(command,cwd,'deploy effect-ci');} catch(error){trustError=error.message;}
        const afterTrustFailure=await stub.inspect();
        await stub.stop();
        const stopped=await stub.execute(command,cwd,'deploy effect-ci');
        return Response.json({denied,published,stopped,before,trustError,afterTrustFailure,after:await stub.inspect()});
      }};
    ` },
    bundle: true, format: "esm", platform: "neutral", target: "esnext", write: false,
    external: ["cloudflare:workers", "node:*"], conditions: ["workerd", "import"],
  });
  const runtime = new Miniflare({ workers: [{ config: {
    name: "main-deploy-environment-test", compatibilityDate: "2026-10-07",
    compatibilityFlags: ["nodejs_compat"],
    manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: output.outputFiles[0].text } } },
    exports: { Probe: { type: "durable-object", storage: "sqlite" } },
    env: { CLOUDFLARE_API_TOKEN: { type: "text", value: "private-fixture-token" },
      CLOUDFLARE_ACCOUNT_ID: { type: "text", value: "fixture-account" } },
  } }] });
  try {
    const response = await runtime.dispatchFetch("https://fixture.invalid/");
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const result = JSON.parse(body);
    assert.equal(result.denied.exitCode, 1);
    assert.equal(result.stopped.exitCode, 1);
    assert.equal(result.published.exitCode, 0);
    assert.equal(result.published.stdout, "effect-ci-outbound-proxy");
    assert.match(result.trustError, /Could not trust/);
    assert.equal(result.afterTrustFailure.calls.filter((call: any) => call.authorized).length, 1,
      "a missing/uninstallable runtime CA must prevent any publication command");
    const publication = result.before.calls.find((call: any) => call.authorized);
    assert.equal(publication.ca, "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
      "Node must trust the runtime HTTPS interception CA without disabling TLS verification");
    const trust = result.before.calls.findIndex((call: any) => call.command?.includes("update-ca-certificates"));
    assert.ok(trust > result.before.calls.findIndex((call: any) => call.intercept === "registry.cloudflare.com"));
    assert.ok(trust < result.before.calls.indexOf(publication), "system trust must be installed before CLI/Docker publication");
    assert.match(result.before.calls[trust].command, /\/etc\/docker\/certs\.d\/registry\.cloudflare\.com\/ca\.crt/,
      "the already-running Docker daemon also needs per-registry CA trust");
    assert.equal(result.before.calls.find((call: any) => call.command === "pnpm build").network, "1",
      "Container exec must explicitly receive the non-secret cf/Docker host-network setting");
    assert.deepEqual(result.before.calls.filter((call: any) => call.intercept).map((call: any) => call.intercept), ["api.cloudflare.com", "registry.cloudflare.com"]);
    const cleanups = result.before.calls.filter((call: any) => call.command?.startsWith("/tmp/effect-ci-docker-"));
    assert.equal(cleanups.length, 1, "remove only this command's generated Docker login directory before commit");
    assert.deepEqual(result.before.calls.filter((call: any) => call.command && !call.command.includes("update-ca-certificates") && !call.command.startsWith("/tmp/effect-ci-docker-"))
      .map((call: any) => call.authorized), [false, false, false, true, false]);
    assert.ok(result.before.stored.some(([key]: any) => key === "mainDeployment"));
    assert.ok(result.after.stored.every(([key]: any) => key !== "mainDeployment"));
    assert.ok(!JSON.stringify(result).includes("private-fixture-token"));
  } finally { await runtime.dispose(); }
});
