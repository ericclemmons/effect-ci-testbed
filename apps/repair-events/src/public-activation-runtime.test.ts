import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("local authenticated delivery -> private producer proof -> SQLite outbox dispatches once across reload", { timeout: 60000 }, async () => {
  const pkg = fileURLToPath(new URL("../", import.meta.url));
  const require = createRequire(import.meta.url);
  const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
  const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
  const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
  const claimedAt = Date.now();
  const observed = new Date(claimedAt + 1).toISOString();
  const policy = { policy: "local-public-v1", service: "local-owned-source", source: "a".repeat(40),
    version: "11111111-1111-1111-1111-111111111111", emission: "local-public-500-v1",
    message: "Local public test failure", fixtureDigest: "b".repeat(64), notificationPolicy: "c".repeat(32) };
  const proof = { emission: policy.emission, version: policy.version,
    currentVersion: policy.version, fixtureDigest: policy.fixtureDigest, claimedAt };
  const event = { alert_type: "workers_observability_real_time_issue", policy_id: policy.notificationPolicy,
    alert_event: "ALERT_STATE_EVENT_START", alert_correlation_id: "22222222-2222-2222-2222-222222222222",
    data: { state_event: "ALERT_STATE_EVENT_START", state_correlation_id: "22222222-2222-2222-2222-222222222222",
      issue: { id: "33333333-3333-3333-3333-333333333333", count: "1", type: "ISSUE_TYPE_EXCEPTION",
        status: "ISSUE_STATUS_ACTIVE", title: policy.message, first_observed: observed, last_observed: observed,
        services: [{ name: policy.service, type: "SERVICE_TYPE_WORKER", first_observed: observed, last_observed: observed }] } } };
  const bundle = async (armed: boolean | "actual") => (await build({
    entryPoints: [join(pkg, "src/worker.ts")], bundle: true, write: false, format: "esm", platform: "neutral",
    external: ["cloudflare:workers", "cloudflare:workflows"],
    // LOCAL HOST fixture, never a runtime flag or an API which arms production.
    plugins: armed !== "actual" ? [{ name: "local-enrollment-only", setup(builder: any) {
      builder.onLoad({ filter: /public-enrollment\.ts$/ }, () => ({ loader: "ts",
        contents: `export const publicIncidentEnrollment = ${armed ? JSON.stringify(policy) : "undefined"};` }));
    } }] : [],
  })).outputFiles[0].text;
  const production = await bundle(false);
  const actualHost = await bundle("actual");
  const armed = await bundle(true);
  const manifest = (contents: string) => ({ mainModule: "index.js", modules: { "index.js": { type: "esm", contents } } });
  const secret = "a".repeat(64);
  const receiver = (code: string) => ({ name: "effect-ci-repair-events", compatibilityDate: "2026-10-07",
    env: { NOTIFICATIONS_SECRET: { type: "text", value: secret },
      PUBLIC_SOURCE: { type: "worker", worker: "local-public-bindings", exportName: "Source" },
      PUBLIC_REPAIR: { type: "worker", worker: "local-public-bindings", exportName: "Dispatcher" } },
    exports: { NotificationCaptures: { type: "durable-object", storage: "sqlite" },
      PublicIncidentActivations: { type: "durable-object", storage: "sqlite" },
      PublicIncidentAdmission: { type: "worker" } }, manifest: manifest(code) });
  const fake = (lost: boolean) => ({ name: "local-public-bindings", compatibilityDate: "2026-10-07",
    exports: { Counter: { type: "durable-object", storage: "sqlite" }, Source: { type: "worker" }, Dispatcher: { type: "worker" } },
    env: { ADMISSION: { type: "worker", worker: "effect-ci-repair-events", exportName: "PublicIncidentAdmission" } },
    manifest: manifest(`import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
      export class Counter extends DurableObject {
        async increment(kind,id){const n=(await this.ctx.storage.get(kind))??0;await this.ctx.storage.put(kind,n+1);if(id)await this.ctx.storage.put('instance',id);}
        async inspect(){return {starts:(await this.ctx.storage.get('starts'))??0,proofs:(await this.ctx.storage.get('proofs'))??0,instance:await this.ctx.storage.get('instance')};}
      }
      export class Source extends WorkerEntrypoint {async readPublicClaim(){await this.ctx.exports.Counter.getByName('local').increment('proofs');return ${JSON.stringify(proof)};}}
      export class Dispatcher extends WorkerEntrypoint {async startPublicIncident(id){await this.ctx.exports.Counter.getByName('local').increment('starts',id);${lost ? "throw new Error('LOCAL created but acknowledgement lost');" : "return {id};"}}}
      export default class extends WorkerEntrypoint {async fetch(request){try{const id=new URL(request.url).searchParams.get('id');return Response.json(id?await this.env.ADMISSION.readPublicAdmission(id):await this.ctx.exports.Counter.getByName('local').inspect());}catch{return new Response('Local read rejected',{status:400});}}}`),
  });
  for (const lost of [false, true]) {
    const binding = fake(lost);
    const runtime = new Miniflare({ workers: [{ config: receiver(actualHost) }, { config: binding }] });
    try {
      let helper = await runtime.getWorker("local-public-bindings");
      const stats = async () => (await helper.fetch("https://local.invalid/")).json();
      const post = (raw: string, auth = secret) => runtime.dispatchFetch("https://owned.invalid/notifications", {
        method: "POST", body: raw, headers: { "content-type": "application/json", "cf-webhook-auth": auth },
      });
      const raw = JSON.stringify(event);
      // Actual production enrollment still cannot read source/dispatch before
      // normal authentication. Local fake services see ZERO unauthorized calls.
      assert.equal((await post(raw, "b".repeat(64))).status, 401);
      assert.equal((await stats()).starts, 0);
      assert.equal((await stats()).proofs, 0);
      // Historical capture-only host behavior remains a distinct local fixture.
      await runtime.setOptions({ workers: [{ config: receiver(production) }, { config: binding }] });
      helper = await runtime.getWorker("local-public-bindings");
      assert.equal((await post(raw)).status, 202);
      assert.equal((await stats()).starts, 0);
      assert.equal((await stats()).proofs, 0);
      await runtime.setOptions({ workers: [{ config: receiver(armed) }, { config: binding }] });
      helper = await runtime.getWorker("local-public-bindings");
      assert.equal((await post(raw, "b".repeat(64))).status, 401);
      assert.equal((await stats()).proofs, 0);
      const replies = await Promise.all(Array.from({ length: 8 }, () => post(raw)));
      assert.ok(replies.every(r => [202, 503].includes(r.status)));
      if (!lost) assert.ok(replies.some(r => r.status === 202));
      else assert.ok(replies.every(r => r.status === 503));
      const first = await stats();
      assert.equal(first.starts, 1);
      assert.match(first.instance, /^public-incident-[a-f0-9]{64}$/);
      const view = await (await helper.fetch(`https://local.invalid/?id=${first.instance}`)).json();
      assert.equal(view.instance, first.instance);
      assert.equal(view.admission.version, policy.version);
      assert.equal(view.admission.issue, event.data.issue.id);
      assert.equal((await helper.fetch("https://local.invalid/?id=foreign")).status, 400);
      await runtime.setOptions({ workers: [{ config: receiver(armed + "\n// local reload") }, { config: binding }] });
      helper = await runtime.getWorker("local-public-bindings");
      assert.equal((await post(JSON.stringify(event, null, 2))).status, lost ? 503 : 202);
      assert.equal((await stats()).starts, 1);
      const foreign = structuredClone(event);
      foreign.data.issue.id = "44444444-4444-4444-4444-444444444444";
      assert.equal((await post(JSON.stringify(foreign))).status, 503);
      assert.equal((await stats()).starts, 1);
    } finally { await runtime.dispose(); }
  }
});
