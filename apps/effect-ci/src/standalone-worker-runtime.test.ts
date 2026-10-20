import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const plugin = await realpath(new URL("../node_modules/@cloudflare/vite-plugin", import.meta.url));
const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
const { build } = require(require.resolve("esbuild", { paths: [plugin] }));

test(
  "standalone entrypoint works in workerd with another identity and no demo service exports",
  { timeout: 30_000 },
  async () => {
    const output = await build({
      entryPoints: [new URL("standalone-worker.ts", import.meta.url).pathname],
      bundle: true,
      write: false,
      format: "esm",
      target: "esnext",
      platform: "neutral",
      external: ["cloudflare:workers", "node:*"],
      conditions: ["workerd", "import"],
      metafile: true,
    });
    const code = output.outputFiles[0].text;
    assert.deepEqual(
      Object.keys(output.metafile.inputs).filter((path) =>
        /apps\/effect-ci\/src\/(demo|small-change|repair|public-incident)/.test(path),
      ),
      [],
    );
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "acme-self-host",
            compatibilityDate: "2026-10-07",
            compatibilityFlags: ["nodejs_compat"],
            manifest: {
              mainModule: "index.js",
              modules: { "index.js": { type: "esm", contents: code } },
            },
            exports: { EffectCIWorkflow: { type: "workflow", name: "acme-self-host-workflow" } },
            env: {
              GITHUB_APP_ID: { type: "text", value: "1234" },
              GITHUB_WEBHOOK_SECRET: { type: "text", value: "fixture-webhook-secret" },
              EFFECT_CI_API_TOKEN: { type: "text", value: "fixture-private-api-token" },
            },
          },
        },
      ],
    });
    try {
      const request = (path: string, init?: RequestInit) =>
        runtime.dispatchFetch("https://acme.invalid" + path, init);
      assert.equal((await request("/capabilities")).status, 401);
      const authenticated = { headers: { authorization: "Bearer fixture-private-api-token" } };
      const response = await request("/capabilities", authenticated);
      assert.equal(response.status, 200);
      const capabilities = await response.json();
      assert.equal(capabilities.protocol, "effect-ci-remote-v1");
      assert.deepEqual(capabilities.targets, []);
      assert.equal(capabilities.targetDiscovery, "project");
      assert.deepEqual(capabilities.authentication, ["api-token"]);
      assert.equal((await request("/demo/capabilities", authenticated)).status, 404);
      assert.equal((await request("/webhooks/github", { method: "POST", body: "{}" })).status, 401);
    } finally {
      await runtime.dispose();
    }
  },
);
