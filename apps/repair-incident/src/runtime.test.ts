import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
test(
  "actual local workerd RPC and SQLite emit once, serialize, and survive reload",
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
    const bundle = async (entry: string) =>
      (
        await build({
          entryPoints: [join(pkg, entry)],
          bundle: true,
          write: false,
          format: "esm",
          platform: "neutral",
          external: ["cloudflare:workers", "cloudflare:workflows"],
        })
      ).outputFiles[0].text;
    const config = (contents: string) => ({
      name: "effect-ci-repair-incident",
      compatibilityDate: "2026-10-07",
      env: { WORKER_METADATA: { type: "json", value: { id: "11111111-1111-1111-1111-111111111111" } } },
      exports: {
        OwnedFaultSource: { type: "worker" },
        OwnedFaultOnce: { type: "durable-object", storage: "sqlite" },
        PublicFailureClaim: { type: "durable-object", storage: "sqlite" },
        PublicIncidentEvidence: { type: "worker" },
        OwnedIncidentWorkflow: {
          type: "workflow",
          name: "effect-ci-owned-incident",
        },
      },
      manifest: {
        mainModule: "index.js",
        modules: { "index.js": { type: "esm", contents } },
      },
    });
    const production = await bundle("src/worker.ts");
    const local = await bundle("fixtures/local.ts");
    const runtime = new Miniflare({
      workers: [{ config: config(production) }],
    });
    try {
      assert.equal(
        (
          await runtime.dispatchFetch("https://owned.invalid/", {
            method: "POST",
            body: '{"mode":"emit-once"}',
          })
        ).status,
        404,
      );
      await runtime.setOptions({ workers: [{ config: config(local) }] });
      const send = async (mode: string) => {
        const response = await runtime.dispatchFetch("https://owned.invalid/", {
          method: "POST",
          body: JSON.stringify({ mode }),
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      const before = await send("inspect");
      assert.equal(before.result.state, "absent");
      const replies = await Promise.all(
        Array.from({ length: 8 }, () => send("emit-once")),
      );
      assert.equal(replies.filter((r) => !r.result.replay).length, 1);
      for (const r of replies) {
        assert.equal(r.result.status, 500);
        assert.equal(r.result.issueVerified, false);
        assert.deepEqual(r.steps, ["incident:emit-once"]);
      }
      await runtime.setOptions({
        workers: [{ config: config(local + "\n// local reload\n") }],
      });
      assert.equal((await send("inspect")).result.state, "complete");
      assert.equal((await send("emit-once")).result.replay, true);
      const denied = await runtime.dispatchFetch("https://owned.invalid/", {
        method: "POST",
        body: '{"mode":"emit-once","message":"untrusted"}',
      });
      assert.equal(denied.status, 400);
      // A local-only HTTP host exercises the actual new SQLite claim and uncaught
      // fetch exception. This is NOT a native WOBS Issue/delivery/repair proof.
      const publicLocal = await bundle("fixtures/public-local.ts");
      await runtime.setOptions({ workers: [{ config: config(publicLocal) }] });
      const evidence = async () => (await runtime.dispatchFetch("https://owned.invalid/__local-evidence")).json();
      assert.deepEqual(await evidence(), { state: "absent" });
      const httpReplies = await Promise.all(
        Array.from({ length: 8 }, () =>
          runtime.dispatchFetch("https://owned.invalid/failure"),
        ),
      );
      assert.equal(httpReplies.filter((r) => r.status === 500).length, 1);
      assert.equal(httpReplies.filter((r) => r.status === 410).length, 7);
      const claimProof = await evidence();
      assert.equal(claimProof.version, "11111111-1111-1111-1111-111111111111");
      assert.equal(claimProof.currentVersion, claimProof.version);
      assert.equal(claimProof.fixtureDigest, "6e3a3627b9fd217104ff0b7d73aba6968d2422558539af3aac2f5f2625ef6dd6");
      assert.ok(Number.isSafeInteger(claimProof.claimedAt));
      await runtime.setOptions({
        workers: [{ config: config(publicLocal + "\n// public claim reload\n") }],
      });
      assert.equal(
        (await runtime.dispatchFetch("https://owned.invalid/failure")).status,
        410,
      );
      assert.deepEqual(await evidence(), claimProof);
      const drifted = config(publicLocal + "\n// local version drift");
      drifted.env.WORKER_METADATA.value.id = "22222222-2222-2222-2222-222222222222";
      await runtime.setOptions({ workers: [{ config: drifted }] });
      assert.deepEqual(await evidence(), {
        ...claimProof, currentVersion: "22222222-2222-2222-2222-222222222222",
      });
      assert.equal((await runtime.dispatchFetch("https://owned.invalid/failure")).status, 410);
      // The separately claimed historic RPC source remains complete, not reset.
      await runtime.setOptions({ workers: [{ config: config(local) }] });
      assert.equal((await send("inspect")).result.state, "complete");
      await runtime.setOptions({ workers: [{ config: config(production) }] });
      assert.equal(
        (await runtime.dispatchFetch("https://owned.invalid/failure")).status,
        404,
      );
      const authored = await readFile(
        join(pkg, "cloudflare.config.ts"),
        "utf8",
      );
      assert.match(authored, /issues: \{ enabled: true \}/);
      assert.match(authored, /workersDev: false/);
      assert.match(authored, /previewUrls: false/);
      assert.match(
        await readFile(join(pkg, "src/worker.ts"), "utf8"),
        /const publicFailureEnabled: boolean = false/,
      );
    } finally {
      await runtime.dispose();
    }
  },
);
