import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";
import { ownedNotificationFixture } from "../fixtures/owned-notification.ts";

test(
  "actual local SQLite semantic Issue dedupe persists independently of capture bytes, concurrency and reload",
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
    const bundle = await build({
      entryPoints: [join(pkg, "fixtures/local-admission.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      external: ["cloudflare:workers", "cloudflare:workflows"],
      // Historical operator admission remains capture-only. Do not let the new
      // production enrollment turn this old fixture into an automatic event.
      plugins: [{ name: "local-historical-capture-host", setup(builder: any) {
        builder.onLoad({ filter: /public-enrollment\.ts$/ }, () => ({ loader: "ts",
          contents: "export const publicIncidentEnrollment = undefined;" }));
      } }],
    });
    const code = bundle.outputFiles[0].text;
    const config = (contents: string) => ({
      name: "effect-ci-repair-events",
      compatibilityDate: "2026-10-07",
      env: { NOTIFICATIONS_SECRET: { type: "text", value: "a".repeat(64) } },
      exports: {
        NotificationCaptures: { type: "durable-object", storage: "sqlite" },
        NotificationEvidence: { type: "worker" },
        OwnedIncidentAdmission: { type: "worker" },
        NotificationInspectionWorkflow: {
          type: "workflow",
          name: "effect-ci-notification-inspection",
        },
        OwnedIncidentAdmissionWorkflow: {
          type: "workflow",
          name: "effect-ci-owned-incident-admission",
        },
      },
      manifest: {
        mainModule: "index.js",
        modules: { "index.js": { type: "esm", contents } },
      },
    });
    const runtime = new Miniflare({ workers: [{ config: config(code) }] });
    try {
      const local = async (value: unknown) =>
        runtime.dispatchFetch("https://owned.invalid/local-admission", {
          method: "POST",
          body: JSON.stringify(value),
        });
      assert.deepEqual(await (await local({ mode: "inspect" })).json(), {
        state: "absent",
      });
      assert.equal((await local({ mode: "admit-retained" })).status, 400); // No pinned real capture in a synthetic local test.
      const event = ownedNotificationFixture();
      const raw = JSON.stringify(event);
      const sha = (s: string) => createHash("sha256").update(s).digest("hex");
      const post = async (s: string) =>
        runtime.dispatchFetch("https://owned.invalid/notifications", {
          method: "POST",
          body: s,
          headers: {
            "content-type": "application/json",
            "cf-webhook-auth": "a".repeat(64),
          },
        });
      assert.equal((await post(raw)).status, 202);
      // Authenticated capture never automatically authorizes admission or inference.
      assert.deepEqual(await (await local({ mode: "inspect" })).json(), {
        state: "absent",
      });
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => local({ digest: sha(raw) })),
      );
      const receipts = await Promise.all(responses.map((r) => r.json()));
      assert.equal(receipts.filter((r) => !r.duplicate).length, 1);
      for (const r of receipts) {
        assert.equal(r.incidentDedupeVerified, true);
        assert.equal(r.identity.repairAuthorized, false);
        assert.equal(r.identity.inferenceTriggered, false);
        assert.deepEqual(r.identity, receipts[0].identity);
        assert.equal(r.admittedAt, receipts[0].admittedAt);
      }
      const formatted = JSON.stringify(
        { ...event, text: "never sent to a model" },
        null,
        2,
      );
      assert.notEqual(sha(formatted), sha(raw));
      assert.equal((await post(formatted)).status, 202);
      assert.equal(
        (await (await local({ digest: sha(formatted) })).json()).duplicate,
        true,
      );
      const wrong = JSON.stringify({ ...event, policy_id: "other" });
      assert.equal((await post(wrong)).status, 202);
      assert.equal((await local({ digest: sha(wrong) })).status, 400); // Reject even AFTER a valid admission exists.
      await runtime.setOptions({
        workers: [{ config: config(code + "\n//reload\n") }],
      });
      const after = await (await local({ mode: "inspect" })).json();
      assert.equal(after.state, "admitted");
      assert.deepEqual(after.identity, receipts[0].identity);
      assert.equal(
        (await (await local({ digest: sha(raw) })).json()).duplicate,
        true,
      );
      assert.equal(
        (await runtime.dispatchFetch("https://owned.invalid/owned-admission"))
          .status,
        404,
      );
    } finally {
      await runtime.dispose();
    }
  },
);
