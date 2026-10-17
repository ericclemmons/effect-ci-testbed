import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { testPaths, testRoot, testRepository, testNotesRef } from "./demo-test-check.ts";

test("the documented test signer reaches the same public Docker boundary from the repo root and demo directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "effect-ci-signer-cwd-"));
  const source = fileURLToPath(new URL("../../../", import.meta.url));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init", "-b", "main");
    git("remote", "add", "origin", testRepository);
    for (const path of testPaths) {
      const target = join(directory, testRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, execFileSync("git", ["show", `HEAD:${testRoot}/${path}`], { cwd: source }), { flag: "wx" });
    }
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Public signer fixture");
    const bin = join(directory, ".git", "fixture-bin");
    mkdirSync(bin);
    // Fail before Docker runs or any signing key can be read. No fake test
    // success, note or signature may be produced by this regression.
    writeFileSync(join(bin, "docker"), "#!/bin/sh\necho PUBLIC_DOCKER_BOUNDARY_REACHED >&2\nexit 42\n", { flag: "wx", mode: 0o700 });
    const module = new URL("./demo-test-signer.ts", import.meta.url).href;
    for (const cwd of [directory, join(directory, testRoot)]) {
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import {attestDemoTests} from ${JSON.stringify(module)}; await attestDemoTests();`], {
        cwd, encoding: "utf8", timeout: 10000, env: { ...process.env, PATH: bin + ":" + process.env.PATH },
      });
      assert.notEqual(result.status, 0, "the simulated Docker failure must stop signing");
      assert.match(result.stderr, /PUBLIC_DOCKER_BOUNDARY_REACHED/, "valid committed inputs must resolve identically from either directory");
      assert.doesNotMatch(result.stderr, /Changed demo suite|Nonregular committed test input/);
      assert.equal(git("status", "--porcelain"), "");
      assert.equal(git("notes", `--ref=${testNotesRef}`, "list"), "", "a failed test cannot produce evidence");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
