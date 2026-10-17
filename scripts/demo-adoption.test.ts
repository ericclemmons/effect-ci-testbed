import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const demo = fileURLToPath(new URL("../examples/demo/", import.meta.url));

test(
  "the real demo test task still passes after adopting its documented GitHub workflow",
  { timeout: 45000 },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "effect-ci-demo-adoption-"));
    try {
      // Consumer app inputs only. Documentation, historical recordings and the
      // verification harness are not prerequisites for testing this Vite app.
      for (const path of [
        "package.json",
        "vite.config.ts",
        "tsconfig.json",
        "src",
        "README.md",
        ".env",
      ])
        cpSync(join(demo, path), join(directory, path), { recursive: true });
      mkdirSync(join(directory, "verification"));
      // Include the exact maintainer test which rejected the user's adopted job.
      for (const path of [
        "demo-guide.test.mjs",
        "effect-on-github.example.yml",
        "github-baseline.example.yml",
      ])
        cpSync(join(demo, "verification", path), join(directory, "verification", path));
      symlinkSync(join(demo, "node_modules"), join(directory, "node_modules"), "dir");
      mkdirSync(join(directory, ".github/workflows"), { recursive: true });
      writeFileSync(
        join(directory, ".github/workflows/github.yml"),
        "name: Adopted CI\non: [push]\npermissions:\n  contents: read\n  checks: write\njobs:\n  ci:\n    uses: ericclemmons/effect-ci-testbed/.github/workflows/effect-ci.yml@main\n    with:\n      workflow: examples/demo\n    secrets: inherit\n",
      );
      // Rehearsals intentionally change this; no original message assertion.
      writeFileSync(
        join(directory, "src/message.ts"),
        'export const message = "My actual rehearsal";\n',
      );
      const result = spawnSync(join(demo, "node_modules/.bin/vpr"), ["test:source"], {
        cwd: directory,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          CI: "true",
          PATH: join(demo, "node_modules/.bin") + ":" + process.env.PATH,
        },
      });
      assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error ?? ""));
      assert.match(result.stdout + result.stderr, /message\.test\.ts/);
      assert.doesNotMatch(result.stdout + result.stderr, /deleted job steps must match/);
      const maintainer = spawnSync(
        process.execPath,
        ["--test", "verification/demo-guide.test.mjs"],
        {
          cwd: directory,
          encoding: "utf8",
          timeout: 10000,
        },
      );
      assert.equal(maintainer.status, 0, maintainer.stdout + maintainer.stderr);
      assert.equal(
        JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).scripts.test,
        "vpr test:source",
      );
      // Separation must not turn a genuine app test failure into success.
      writeFileSync(join(directory, "src/message.ts"), 'export const message = "";\n');
      const negative = spawnSync(join(demo, "node_modules/.bin/vpr"), ["test:source"], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          CI: "true",
          PATH: join(demo, "node_modules/.bin") + ":" + process.env.PATH,
        },
      });
      assert.notEqual(negative.status, 0);
      assert.match(negative.stdout + negative.stderr, /message\.test\.ts/);
      assert.match(negative.stdout + negative.stderr, /greater than|toBeGreaterThan/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
