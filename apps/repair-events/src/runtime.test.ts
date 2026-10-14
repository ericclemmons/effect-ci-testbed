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
      external: ["cloudflare:workers"],
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
      await runtime.setOptions({
        workers: [
          { config: real(code + "\n// local reload\n") },
          { config: reader },
        ],
      });
      read = await runtime.getWorker("local-evidence-reader");
      assert.deepEqual(await inventory(), ids);
      for (let i = 0; i < 3; i++)
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
