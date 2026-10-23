import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { projectEnvironment } from "./project-env.ts"

test("automatic environment loading stops at the repo and honors local/directory precedence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cf-ci-env-"))
  try {
    const root = join(directory, "repo")
    const nested = join(root, "src")
    await mkdir(join(root, ".git"), { recursive: true })
    await mkdir(nested)
    await writeFile(join(directory, ".env.local"), "OUTSIDE=must-not-load\n")
    await writeFile(join(root, ".env"), "VALUE=default\nEFFECT_CI_API_TOKEN=default\n")
    await writeFile(join(root, ".env.local"), "VALUE=local\nEFFECT_CI_API_TOKEN=local-token\nEFFECT_CI_PUBLIC_URL=https://fixture.invalid\n")
    assert.deepEqual(projectEnvironment(nested), {
      VALUE: "local", EFFECT_CI_API_TOKEN: "local-token", EFFECT_CI_PUBLIC_URL: "https://fixture.invalid",
      EFFECT_CI_REMOTE_TOKEN: "local-token", EFFECT_CI_REMOTE_URL: "https://fixture.invalid",
    })
    await writeFile(join(nested, ".env.local"), "VALUE=nested\n")
    assert.equal(projectEnvironment(nested).VALUE, "nested")
    // Exercise actual startup, including shell and explicit-file precedence.
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    await mkdir(join(root, ".cloudflare/ci"), { recursive: true })
    const sdk = fileURLToPath(new URL("../../ci/src/index.ts", import.meta.url))
    await writeFile(join(root, ".cloudflare/ci/workflow.ts"), `import * as CI from ${JSON.stringify(sdk)}; export default CI.workflow(process.env.VALUE, function* () {});`)
    const bin = fileURLToPath(new URL("bin.ts", import.meta.url))
    const run = (value?: string, explicit = false) => {
      const env = { ...process.env }
      delete env.VALUE
      if (value !== undefined) env.VALUE = value
      const result = spawnSync(process.execPath, [bin, "list", "--format=json", ...(explicit ? ["--env-file", ".env.explicit"] : [])], { cwd: nested, env, encoding: "utf8" })
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout).workflow
    }
    assert.equal(run(), "nested")
    assert.equal(run("shell"), "shell")
    await writeFile(join(nested, ".env.explicit"), "VALUE=explicit\n")
    assert.equal(run("shell", true), "explicit")
  } finally { await rm(directory, { recursive: true, force: true }) }
})
