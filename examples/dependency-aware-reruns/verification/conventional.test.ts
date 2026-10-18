import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = "examples/dependency-aware-reruns/verification/conventional.mjs";
for (const scenario of ["input", "unchanged", "missing", "tampered", "program", "runtime"]) {
  test(`conventional conditions preserve exact outputs: ${scenario}`, () => {
    const temp = mkdtempSync(join(tmpdir(), "effect-ci-conventional-test-"));
    try {
      const env = { ...process.env, RUNNER_TEMP: temp, GITHUB_OUTPUT: join(temp, "outputs") };
      execFileSync(process.execPath, [script, "prepare", scenario], { env });
      const outputs = Object.fromEntries(readFileSync(env.GITHUB_OUTPUT, "utf8").trim().split("\n").map(line => line.split("=")));
      const nextEnv = { ...env, COMPARISON_ROOT: outputs.root };
      for (const name of ["left", "right", "bundle"]) {
        if (outputs[name] === "true") execFileSync(process.execPath, [script, "run", name], { env: nextEnv });
        else assert.throws(() => execFileSync(process.execPath, [script, "run", name], { env: nextEnv, stdio: "pipe" }));
      }
      const proof = JSON.parse(execFileSync(process.execPath, [script, "verify"], { env: nextEnv, encoding: "utf8" }));
      assert.equal(proof.fullComparison, true);
      assert.equal(proof.scenario, scenario);
      assert.equal(proof.output, scenario === "program" ? "CHARLIE! / BRAVO!\n" : "CHARLIE / BRAVO\n");
    } finally { rmSync(temp, { recursive: true }); }
  });
}
