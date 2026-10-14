import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test(
  "actual Flue generator builds via modern cf config and its real SQLite DO recovers a settled reply",
  { timeout: 60_000 },
  async () => {
    const pkg = fileURLToPath(new URL("../", import.meta.url));
    const fixture = join(pkg, "fixtures/native");
    const dir = await mkdtemp(join(tmpdir(), "effect-ci-flue-generated-"));
    const require = createRequire(import.meta.url);
    const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    let runtime: InstanceType<typeof Miniflare> | undefined;
    try {
      await cp(fixture, dir, { recursive: true });
      await symlink(join(pkg, "node_modules"), join(dir, "node_modules"), "dir");
      // Use the original config's lexical package imports, but an isolated root.
      // Only owned fake fixtures are copied. No cf auth, deploy or model request.
      execFileSync(
        process.execPath,
        [
          join(pkg, "node_modules/vite/bin/vite.js"),
          "build",
          dir,
          "--config",
          join(fixture, "vite.config.ts"),
        ],
        { cwd: dir, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      );
      const output = join(dir, ".cloudflare/output/v0/workers/default");
      const config = JSON.parse(await readFile(join(output, "worker.config.json"), "utf8"));
      assert.equal(config.workersDev, false);
      assert.equal(config.previewUrls, false);
      assert.deepEqual(Object.keys(config.env), ["FLUE_OWNED_PROPOSAL_AGENT"]);
      assert.deepEqual(config.exports, {
        FlueOwnedProposalAgent: { type: "durable-object", storage: "sqlite" },
      });
      assert.ok(config.compatibilityFlags.includes("nodejs_compat"));
      const modules: Record<string, { type: "esm"; contents: string }> = {};
      const bundle = join(output, "bundle");
      const load = async (path: string) => {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const full = join(path, entry.name);
          if (entry.isDirectory()) await load(full);
          else if (entry.name.endsWith(".js"))
            modules[relative(bundle, full)] = {
              type: "esm",
              contents: await readFile(full, "utf8"),
            };
        }
      };
      await load(bundle);
      config.manifest = { mainModule: "index.js", modules };
      runtime = new Miniflare({ workers: [{ config }] });
      const send = async (input: object) => {
        const response = await runtime!.dispatchFetch("https://owned.invalid/owned-fake-probe", {
          method: "POST",
          body: JSON.stringify(input),
          headers: { "content-type": "application/json" },
        });
        const value = await response.json();
        assert.equal(response.status, 200, JSON.stringify(value));
        assert.equal(value.fakeInference, true);
        return value;
      };
      const first = await send({ mode: "run" });
      assert.equal(first.reply.text, "OK");
      assert.equal(first.reply.metadata.fakeCalls, 1);
      const reload = {
        ...config,
        manifest: {
          ...config.manifest,
          modules: {
            ...modules,
            "index.js": {
              type: "esm",
              contents: modules["index.js"].contents + "\n// owned fixture reload\n",
            },
          },
        },
      };
      await runtime.setOptions({ workers: [{ config: reload }] });
      const restored = await send({ mode: "read", receipt: first.receipt });
      assert.deepEqual(restored.reply, first.reply);
      assert.equal(restored.reply.metadata.fakeCalls, 1);
    } finally {
      await runtime?.dispose();
      // This directory was created exclusively for the fake fixture test.
      await rm(dir, { recursive: true, force: true });
    }
  },
);
