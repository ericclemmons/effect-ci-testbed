import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/** Credential-free image proof, not a native Cloudflare deployment. */
test(
  "standalone image runs a clean pnpm fixture install/test/build without network or host secrets",
  {
    skip: process.env.VERIFY_STANDALONE_IMAGE !== "1",
    timeout: 180_000,
  },
  () => {
    const app = fileURLToPath(new URL("..", import.meta.url));
    const output = join(app, ".cloudflare/output/v0");
    const config = JSON.parse(
      readFileSync(join(output, "workers/default/worker.config.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(config.exports).sort(), [
      "EffectCIWorkflow",
      "GitCheckoutOutbound",
      "WorkspaceContainer",
    ]);
    const name = config.exports.WorkspaceContainer.container;
    assert.match(name, /^[a-z][a-z0-9-]+$/);
    const container = JSON.parse(
      readFileSync(join(output, "containers", name, "container.config.json"), "utf8"),
    );
    assert.deepEqual(Object.keys(container.images), ["workspace"]);
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), "effect-ci-standalone-image-")));
    const instance = `effect-ci-standalone-image-${crypto.randomUUID()}`;
    try {
      // Only tracked fixture files: no ignored env files, local dependencies or credentials.
      const archive = execFileSync("git", ["archive", "--format=tar", "HEAD:examples/node-pnpm"], {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      });
      execFileSync("tar", ["-x", "-C", fixture], { input: archive });
      const manifest = JSON.parse(readFileSync(join(fixture, "package.json"), "utf8"));
      assert.equal(manifest.packageManager, "pnpm@12.8.1");
      assert.equal(manifest.scripts.test, "node --test");
      const result = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          instance,
          "--platform",
          "linux/amd64",
          "--network",
          "none",
          // Bind-mounted outputs must remain owned by the invoking user on Linux.
          "--user",
          `${process.getuid!()}:${process.getgid!()}`,
          "--env",
          "HOME=/tmp",
          "--mount",
          `type=bind,source=${fixture},target=/workspace/repository`,
          "--workdir",
          "/workspace/repository",
          "--entrypoint",
          "/bin/sh",
          container.images.workspace.localReference,
          "-c",
          "node --version && pnpm --version && pnpm --ignore-workspace install --offline && pnpm --ignore-workspace run test && pnpm --ignore-workspace run build",
        ],
        { encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /^v24\.22\.0$/m);
      assert.match(result.stdout, /^12\.8\.1$/m);
      assert.match(result.stdout, /tests 1/);
      assert.equal(
        readFileSync(join(fixture, "dist/index.js"), "utf8"),
        readFileSync(join(fixture, "src/index.js"), "utf8"),
      );
    } finally {
      // Only this test's uniquely named container and generated fixture.
      spawnSync("docker", ["rm", "--force", instance], { stdio: "ignore", timeout: 10_000 });
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);
