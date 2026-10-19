import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  testCommand,
  testFixedInputs,
  testIdentity,
  testInspectCommand,
  testPaths,
  testPolicyDigest,
} from "./demo-test-check.ts";

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "demo-test-policy-unit-"));
  for (const path of testPaths) {
    const dest = join(cwd, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(new URL(`../../../test/fixtures/demo/${path}`, import.meta.url)));
  }
  // The enrolled policy deliberately keeps its original manifest bytes. The
  // maintenance fixture's test-folder rename is not a new signing enrollment.
  const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  const originalScripts: Record<string, string> = {
    "test:verification": "node --test verification/*.test.mjs verification/*.test.ts",
    "verify:browser": "node verification/run.mjs",
    "proof:preview": "node verification/preview-proof.mjs",
    "proof:verify-published": "node verification/verify-published.mjs",
  };
  manifest.scripts = Object.fromEntries(Object.entries(manifest.scripts).map(([key, value]) => {
    const original = key === "test:integration" ? "test:verification" : key;
    return [original, originalScripts[original] ?? value];
  }));
  writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  mkdirSync(join(cwd, "node_modules"));
  writeFileSync(join(cwd, "node_modules/dependency.js"), "fixed dependency");
  const inspect = () =>
    JSON.parse(
      execFileSync(
        "/bin/sh",
        ["-c", testInspectCommand.replace("/usr/local/bin/node", `'${process.execPath}'`)],
        { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  return { cwd, inspect };
}
const linux = (v: any) => ({ ...v, platform: "linux", arch: "x64", runtime: "v24.22.0" });
test("trusted inspector reads eligible committed inputs and actual dependency bytes", async () => {
  const f = fixture(),
    before = f.inspect();
  assert.equal(before.files.length, testPaths.length);
  assert.equal(before.dependencyFiles, 1);
  const first = await testIdentity("a".repeat(40), JSON.stringify(linux(before)));
  writeFileSync(join(f.cwd, "node_modules/dependency.js"), "changed");
  const changed = await testIdentity(first.revision, JSON.stringify(linux(f.inspect())));
  assert.notEqual(changed.sourceDigest, first.sourceDigest);
  assert.equal(first.stepId, "test");
  assert.equal(first.command, testCommand);
  assert.equal(first.policyDigest, await testPolicyDigest());
});
test("inspector rejects executable message, changed test/config and extra source files", () => {
  for (const [path, text] of [
    ["src/message.ts", 'export const message = "hi"; throw Error("must not execute");'],
    ["src/message.test.ts", "changed test"],
    ["vite.config.ts", "changed config"],
    ["src/other.test.ts", "another test"],
  ]) {
    const f = fixture();
    writeFileSync(join(f.cwd, path!), text!);
    assert.throws(f.inspect);
  }
});
test("maintenance script changes do not silently enroll a different manifest", () => {
  const f = fixture();
  writeFileSync(join(f.cwd, "package.json"), readFileSync(new URL("../../../test/fixtures/demo/package.json", import.meta.url)));
  assert.throws(f.inspect, /Changed suite policy/);
});
test("inspector rejects dependency links outside its isolated prepared tree", () => {
  const f = fixture();
  symlinkSync(process.execPath, join(f.cwd, "node_modules/escape"));
  assert.throws(f.inspect);
});
test("generated cache is not a required input, but changed real dependencies are", () => {
  const f = fixture(),
    before = f.inspect();
  mkdirSync(join(f.cwd, "node_modules/.vite/vitest"), { recursive: true });
  writeFileSync(join(f.cwd, "node_modules/.vite/vitest/results.json"), "generated");
  assert.equal(f.inspect().dependencies, before.dependencies);
});

test("dependency executable permissions are part of the identity", () => {
  const f = fixture(),
    path = join(f.cwd, "node_modules/dependency.js");
  chmodSync(path, 0o644);
  const before = f.inspect();
  chmodSync(path, 0o755);
  assert.notEqual(f.inspect().dependencies, before.dependencies);
});

test("unexpected code under cache-like names is still an input", () => {
  for (const directory of [".vite", ".cache"]) {
    const f = fixture(),
      before = f.inspect();
    mkdirSync(join(f.cwd, "node_modules", directory));
    writeFileSync(
      join(f.cwd, "node_modules", directory, "compiled.js"),
      "unexpected executable code",
    );
    assert.notEqual(f.inspect().dependencies, before.dependencies);
  }
});
test("identity rejects altered suite, incomplete runtime and malformed descriptors", async () => {
  const v = linux(fixture().inspect()),
    revision = "a".repeat(40);
  for (const patch of [
    { platform: "darwin" },
    { arch: "arm64" },
    { runtime: "v26.0.0" },
    { dependencies: "claimed" },
    { dependencyFiles: 0 },
    { files: v.files.slice(1) },
  ])
    await assert.rejects(testIdentity(revision, JSON.stringify({ ...v, ...patch })));
  const files = structuredClone(v.files);
  files.find((f: any) => testFixedInputs[f.path]).sha256 = "a".repeat(64);
  await assert.rejects(testIdentity(revision, JSON.stringify({ ...v, files })));
  await assert.rejects(testIdentity("main", JSON.stringify(v)));
  await assert.rejects(testIdentity(revision, "x".repeat(16385)));
});
