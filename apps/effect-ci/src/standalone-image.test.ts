import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
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
      // Public tracked fixture only; the image's default uid reads it, never writes it.
      chmodSync(fixture, 0o755);
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
          "--mount",
          `type=bind,source=${fixture},target=/fixture,readonly`,
          "--workdir",
          "/workspace",
          "--entrypoint",
          "/bin/sh",
          container.images.workspace.localReference,
          "-c",
          'test "$(id -u)" = 1000 && test ! -w /usr/local/bin/node && test ! -w /usr/local/bin/pnpm && node --version && pnpm --version && mkdir repository && cp -R /fixture/. repository/ && cd repository && pnpm --ignore-workspace install --offline && pnpm --ignore-workspace run test && pnpm --ignore-workspace run build && cmp src/index.js dist/index.js && echo UNPRIVILEGED_BUILD_VERIFIED',
        ],
        { encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /^v24\.22\.0$/m);
      assert.match(result.stdout, /^12\.8\.1$/m);
      assert.match(result.stdout, /tests 1/);
      assert.match(result.stdout, /^UNPRIVILEGED_BUILD_VERIFIED$/m);
    } finally {
      // Only this test's uniquely named container and generated fixture.
      spawnSync("docker", ["rm", "--force", instance], { stdio: "ignore", timeout: 10_000 });
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);
