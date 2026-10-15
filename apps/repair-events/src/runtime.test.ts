import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
test(
  "actual local authenticated ingress and SQLite quarantine dedupe persist across reload",
  { timeout: 60000 },
  async () => {
    const pkg = fileURLToPath(new URL("../", import.meta.url));
    const require = createRequire(import.meta.url);
    const plugin = await realpath(
      join(pkg, "node_modules/@cloudflare/vite-plugin"),
    );
    const { Miniflare } = require(
      require.resolve("miniflare", { paths: [plugin] }),
    );
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    const compiled = await build({
      entryPoints: [join(pkg, "src/worker.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      external: ["cloudflare:workers", "cloudflare:workflows"],
      // Preserve the historical capture-only host regression independently of
      // the production public-incident enrollment and its private capabilities.
      plugins: [{ name: "local-capture-only-host", setup(builder: any) {
        builder.onLoad({ filter: /public-enrollment\.ts$/ }, () => ({ loader: "ts",
          contents: "export const publicIncidentEnrollment = undefined;" }));
      } }],
    });
    const code = compiled.outputFiles[0].text;
    const secret = "a".repeat(64);
    const real = (contents: string) => ({
      name: "effect-ci-repair-events",
      compatibilityDate: "2026-10-07",
      env: { NOTIFICATIONS_SECRET: { type: "text", value: secret } },
      exports: {
        NotificationCaptures: { type: "durable-object", storage: "sqlite" },
        NotificationEvidence: { type: "worker" },
        NotificationInspectionWorkflow: {
          type: "workflow",
          name: "effect-ci-notification-inspection",
        },
      },
      manifest: {
        mainModule: "index.js",
        modules: { "index.js": { type: "esm", contents } },
      },
    });
    // A separate LOCAL helper holds only the private evidence service binding,
    // not the receiver secret. It is never shipped in the production bundle.
    const reader = {
      name: "local-evidence-reader",
      compatibilityDate: "2026-10-07",
      env: {
        EVIDENCE: {
          type: "worker",
          worker: "effect-ci-repair-events",
          exportName: "NotificationEvidence",
        },
      },
      manifest: {
        mainModule: "index.js",
        modules: {
          "index.js": {
            type: "esm",
            contents: `import { WorkerEntrypoint } from 'cloudflare:workers'; export default class extends WorkerEntrypoint {async fetch(request) {if (this.env.NOTIFICATIONS_SECRET !== undefined) throw new Error('Secret leaked'); const id=new URL(request.url).searchParams.get('id'); return Response.json(id?await this.env.EVIDENCE.read(id):await this.env.EVIDENCE.inventory());}}`,
          },
        },
      },
    };
    const runtime = new Miniflare({
      workers: [{ config: real(code) }, { config: reader }],
    });
    try {
      let read = await runtime.getWorker("local-evidence-reader");
      const inventory = async () =>
        (await read.fetch("https://private.invalid/")).json();
      const post = async (raw: string, auth: string | null = secret) =>
        runtime.dispatchFetch("https://owned.invalid/notifications", {
          method: "POST",
          body: raw,
          headers: {
            "content-type": "application/json",
            ...(auth === null ? {} : { "cf-webhook-auth": auth }),
          },
        });
      assert.equal(
        (await runtime.dispatchFetch("https://owned.invalid/")).status,
        404,
      );
      assert.equal(
        (await runtime.dispatchFetch("https://owned.invalid/notifications"))
          .status,
        405,
      );
      assert.equal((await post("{}", null)).status, 401);
      assert.equal((await post("{}", "b".repeat(64))).status, 401);
      assert.deepEqual(await inventory(), []);
      assert.equal(
        (
          await post(
            '{"text":"Owned non-Issue callback; no capture authority"}',
          )
        ).status,
        204,
      );
      assert.deepEqual(await inventory(), []);
      const raw =
        '{"alert_type":"workers_observability_real_time_issue","data":{"owned":"PRIVATE-SENTINEL"}}';
      const responses = await Promise.all(
        Array.from({ length: 12 }, () => post(raw)),
      );
      for (const response of responses) {
        assert.equal(response.status, 202);
        assert.equal(await response.text(), "");
      }
      const ids = await inventory();
      assert.equal(ids.length, 1);
      const capture = await (
        await read.fetch(`https://private.invalid/?id=${ids[0]}`)
      ).json();
      assert.equal(capture.raw, raw);
      assert.equal(capture.quarantined, true);
      assert.equal(capture.incidentDedupeVerified, false);
      assert.equal(typeof capture.receivedAt, "number");
      assert.equal(
        (
          await runtime.dispatchFetch(
            "https://owned.invalid/local-inspection",
            { method: "POST", body: '{"mode":"inventory"}' },
          )
        ).status,
        404,
      );
      const localBundle = await build({
        entryPoints: [join(pkg, "fixtures/local.ts")],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        external: ["cloudflare:workers", "cloudflare:workflows"],
      });
      await runtime.setOptions({
        workers: [
          { config: real(localBundle.outputFiles[0].text) },
          { config: reader },
        ],
      });
      read = await runtime.getWorker("local-evidence-reader");
      const inspect = async (payload: unknown) => {
        const response = await runtime.dispatchFetch(
          "https://owned.invalid/local-inspection",
          { method: "POST", body: JSON.stringify(payload) },
        );
        assert.equal(response.status, 200);
        return response.json();
      };
      const list = await inspect({ mode: "inventory" });
      assert.deepEqual(list.result.digests, ids);
      assert.deepEqual(list.steps, ["notification:inventory"]);
      const single = await inspect({ mode: "read", digest: ids[0] });
      assert.equal(single.result.raw, raw);
      assert.equal(single.result.digest, ids[0]);
      assert.equal(single.result.quarantined, true);
      assert.equal(single.result.incidentDedupeVerified, false);
      assert.deepEqual(single.steps, ["notification:read"]);
      assert.equal((await runtime.dispatchFetch("https://owned.invalid/local-inspection", {
        method: "POST", body: JSON.stringify({ mode: "public-source" }),
      })).status, 400); // Missing private capability cannot read or fabricate a claim.
      await runtime.setOptions({
        workers: [
          { config: real(code + "\n// local reload\n") },
          { config: reader },
        ],
      });
      read = await runtime.getWorker("local-evidence-reader");
      assert.deepEqual(await inventory(), ids);
      const unclassified = '{"unknownEnvelope":"LOCAL ONLY; not an Issue"}';
      assert.equal((await post(unclassified)).status, 202);
      const diagnosticId = (await inventory()).find(
        (id: string) => !ids.includes(id),
      );
      const diagnostic = await (
        await read.fetch(`https://private.invalid/?id=${diagnosticId}`)
      ).json();
      assert.equal(diagnostic.raw, unclassified);
      assert.equal(diagnostic.quarantined, true);
      assert.equal(diagnostic.incidentDedupeVerified, false);
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await post(
              JSON.stringify({
                alert_type: "workers_observability_real_time_issue",
                data: { fixture: i },
              }),
            )
          ).status,
          202,
        );
      assert.equal((await inventory()).length, 4);
      assert.equal(
        (
          await post(
            '{"alert_type":"workers_observability_real_time_issue","data":{"fixture":"fifth"}}',
          )
        ).status,
        503,
      );
      assert.equal((await post(raw)).status, 202);
      assert.equal(
        (await post('{"alert_type":"workers_observability_alert","data":{}}'))
          .status,
        503,
      );
      assert.equal((await inventory()).length, 4);
    } finally {
      await runtime.dispose();
    }
  },
);
