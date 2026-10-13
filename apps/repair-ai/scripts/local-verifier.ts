import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { BROKEN_SOURCE, FIXED_SOURCE } from "../../../packages/github/src/repair.ts"

export const TEST_SOURCE = readFileSync(new URL("../fixtures/repair-demo/health.test.mjs", import.meta.url), "utf8")
export const PACKAGE_SOURCE = readFileSync(new URL("../fixtures/repair-demo/package.json", import.meta.url), "utf8")

/** Execute only these pinned owned fixture bytes, with no inherited credential env. */
export function verifyLocal(source: string, testSource: string, packageSource: string) {
  if (![BROKEN_SOURCE, FIXED_SOURCE].includes(source) || testSource !== TEST_SOURCE || packageSource !== PACKAGE_SOURCE) throw new Error("Owned verifier fixture bytes required")
  const directory = mkdtempSync(join(tmpdir(), "effect-ci-repair-check-"))
  mkdirSync(join(directory, "repair-demo"))
  writeFileSync(join(directory, "repair-demo", "health.js"), source, { flag: "wx", mode: 0o600 })
  writeFileSync(join(directory, "repair-demo", "health.test.mjs"), testSource, { flag: "wx", mode: 0o600 })
  writeFileSync(join(directory, "repair-demo", "package.json"), packageSource, { flag: "wx", mode: 0o600 })
  const start = performance.now()
  const result = spawnSync(process.execPath, ["--test", "repair-demo/health.test.mjs"], {
    cwd: directory, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024,
  })
  return { passed: result.status === 0 && !result.error, exitCode: result.status,
    sourceDigest: createHash("sha256").update(source).digest("hex"), elapsedMs: Math.round(performance.now() - start),
    directory, output: result.stdout, errorOutput: result.stderr }
}
