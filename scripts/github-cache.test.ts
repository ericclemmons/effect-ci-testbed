import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { githubCache } from "./github-cache.ts";

test("automatic cache scopes paths, fingerprints inputs, and saves updates across commits", () => {
  const workspace = mkdtempSync(join(tmpdir(), "effect-ci-cache-"));
  try {
    mkdirSync(join(workspace, "app/.cloudflare/ci"), { recursive: true });
    writeFileSync(join(workspace, "app/package.json"), '{"name":"app"}');
    writeFileSync(join(workspace, "app/package-lock.json"), "first lock");
    const options = {
      workspace,
      workflow: "app/.cloudflare/ci/workflow.ts",
      revision: "a".repeat(40),
    };
    const first = githubCache(options);
    assert.equal(first.enabled, true);
    assert.match(first.paths, /app\/node_modules\/\.vite\/task-cache/);
    assert.match(first.paths, /app\/\.effect-ci\/cache/);
    assert.equal(first.paths.includes("node_modules\n"), false);
    const next = githubCache({ ...options, revision: "b".repeat(40) });
    assert.equal(next.restoreKey, first.restoreKey);
    assert.notEqual(next.key, first.key);
    writeFileSync(join(workspace, "app/package-lock.json"), "changed lock");
    assert.notEqual(githubCache(options).restoreKey, first.restoreKey);
    writeFileSync(join(workspace, "pnpm-lock.yaml"), "ancestor lock");
    assert.notEqual(githubCache(options).restoreKey, next.restoreKey);
    const override = githubCache({ ...options, paths: "app/.cache/build", namespace: "custom" });
    assert.equal(override.paths, "app/.cache/build");
    assert.notEqual(override.restoreKey, first.restoreKey);
    assert.throws(() => githubCache({ ...options, workflow: "../outside" }), /inside/);
    assert.throws(() => githubCache({ ...options, revision: "main" }), /revision/);
    assert.equal(githubCache({ ...options, workflow: "app" }).enabled, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("cache false is a complete opt-out, including discovery", () => {
  assert.deepEqual(
    githubCache({
      workspace: "/nonexistent",
      workflow: "/outside",
      revision: "main",
      enabled: false,
    }),
    { enabled: false, paths: "", key: "", restoreKey: "" },
  );
});

test("Actions output is generated without caller cache keys or paths", () => {
  const workspace = mkdtempSync(join(tmpdir(), "effect-ci-cache-output-"));
  try {
    writeFileSync(join(workspace, "package.json"), '{"name":"standalone"}');
    const output = join(workspace, "outputs");
    execFileSync(process.execPath, [new URL("./github-cache.ts", import.meta.url).pathname], {
      env: {
        GITHUB_WORKSPACE: workspace,
        GITHUB_SHA: "a".repeat(40),
        GITHUB_OUTPUT: output,
        CACHE_WORKFLOW: ".",
      },
    });
    const values = readFileSync(output, "utf8");
    assert.match(values, /enabled<<[^\n]+\ntrue\n/);
    assert.match(values, /node_modules\/\.vite\/task-cache/);
    assert.match(values, /\.effect-ci\/cache/);
    assert.match(
      values,
      new RegExp(`key<<[^\\n]+\\neffect-ci-v1-[a-f0-9]{64}-${"a".repeat(40)}\\n`),
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
