import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
test(
  "generated private agent uses a durable contextual slot and recovers without a second fake inference",
  { timeout: 120_000 },
  async () => {
    const pkg = fileURLToPath(new URL("../", import.meta.url));
    const dir = await mkdtemp(join(tmpdir(), "effect-ci-private-flue-"));
    const require = createRequire(import.meta.url);
    const plugin = await realpath(join(pkg, "node_modules/@cloudflare/vite-plugin"));
    const { Miniflare } = require(require.resolve("miniflare", { paths: [plugin] }));
    const { build } = require(require.resolve("esbuild", { paths: [plugin] }));
    let runtime: InstanceType<typeof Miniflare> | undefined;
    try {
      await cp(join(pkg, "src"), join(dir, "src"), { recursive: true });
      for (const file of ["cloudflare.config.ts", "flue.config.ts", "package.json"])
        await cp(join(pkg, file), join(dir, file));
      await cp(join(pkg, "fixtures/local/app.ts"), join(dir, "src/app.ts"));
      await symlink(join(pkg, "node_modules"), join(dir, "node_modules"), "dir");
      execFileSync(
        process.execPath,
        [
          join(pkg, "node_modules/vite/bin/vite.js"),
          "build",
          dir,
          "--config",
          join(pkg, "vite.config.ts"),
        ],
        { cwd: dir, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
      );
      const output = join(dir, ".cloudflare/output/v0/workers/default");
      const config = JSON.parse(await readFile(join(output, "worker.config.json"), "utf8"));
      assert.equal(config.workersDev, false);
      assert.equal(config.previewUrls, false);
      assert.deepEqual(Object.keys(config.env).sort(), [
        "FLUE_OWNED_REPAIR_PROPOSAL_AGENT",
        "REPAIR_AI",
      ]);
      assert.equal(config.exports.ProposalProbeWorkflow.type, "workflow");
      assert.equal(config.exports.FlueOwnedRepairProposalAgent.storage, "sqlite");
      const modules: Record<string, { type: "esm"; contents: string }> = {};
      const bundle = join(output, "bundle");
      const load = async (path: string) => {
        for (const e of await readdir(path, { withFileTypes: true })) {
          const full = join(path, e.name);
          if (e.isDirectory()) await load(full);
          else if (e.name.endsWith(".js"))
            modules[relative(bundle, full)] = {
              type: "esm",
              contents: await readFile(full, "utf8"),
            };
        }
      };
      await load(bundle);
      config.manifest = { mainModule: "index.js", modules };
      const fake = await build({
        entryPoints: [join(pkg, "fixtures/local/budget.ts")],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        external: ["cloudflare:workers"],
      });
      const fakeConfig = {
        name: "effect-ci-repair-ai",
        compatibilityDate: "2026-10-07",
        exports: { FakeBudget: { type: "durable-object", storage: "sqlite" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: fake.outputFiles[0].text } },
        },
      };
      runtime = new Miniflare({ workers: [{ config }, { config: fakeConfig }] });
      const send = async (input: object) => {
        const response = await runtime!.dispatchFetch("https://owned.invalid/", {
          method: "POST",
          body: JSON.stringify(input),
        });
        const value = await response.json();
        assert.equal(response.status, 200, JSON.stringify(value));
        assert.equal(value.fakeInference, true);
        return value;
      };
      const inspect = await send({ mode: "inspect" });
      assert.equal(inspect.result.inferenceCalled, false);
      assert.equal(inspect.result.before.reservedCents, 0);
      const first = await send({ mode: "proposal" });
      assert.equal(first.result.text, "export function healthStatus() { return 200; }");
      assert.match(first.result.reservationId, /^flue_[a-f0-9]{64}$/);
      assert.equal(first.result.after.reservedCents, 10);
      assert.equal(first.result.repairVerified, false);
      const reload = {
        ...config,
        manifest: {
          ...config.manifest,
          modules: {
            ...modules,
            "index.js": {
              type: "esm",
              contents: modules["index.js"].contents + "\n// owned reload\n",
            },
          },
        },
      };
      await runtime.setOptions({ workers: [{ config: reload }, { config: fakeConfig }] });
      const restored = await send({ mode: "read", receipt: first.result.receipt });
      assert.equal(restored.reply.text, first.result.text);
      assert.equal(restored.reply.metadata.reservationId, first.result.reservationId);
      assert.equal(restored.budget.reservedCents, 10);
      assert.equal(restored.budget.reservations.length, 1);
      // A second submission in the same owned DO cannot allocate a fresh paid
      // identity after reload. The fake broker rejects duplicates independently.
      const denied = await runtime.dispatchFetch("https://owned.invalid/", {
        method: "POST",
        body: JSON.stringify({ mode: "proposal" }),
      });
      assert.equal(denied.status, 400);
      const rejection = await denied.json();
      assert.equal(rejection.error, "Owned test proposal rejected");
      assert.equal(rejection.budget.reservedCents, 10);
      assert.equal(rejection.budget.reservations.length, 1);
    } finally {
      await runtime?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
