import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { outputManifestCommand, parseOutputManifest } from "@effect-ci-testbed/cloudflare/output-manifest"

test("the snapshot-site image independently reads binary output without network or root writes", {
  skip: process.env.VERIFY_SNAPSHOT_SITE_IMAGE !== "1", timeout: 60_000,
}, () => {
  const output = new URL("./.cloudflare/output/v0/", import.meta.url)
  const worker = JSON.parse(readFileSync(new URL("workers/default/worker.config.json", output), "utf8"))
  assert.deepEqual(Object.keys(worker.exports).sort(), ["Site", "SiteWorkflow", "SnapshotDeploymentBaselines", "WorkspaceContainer"])
  assert.deepEqual(Object.keys(worker.env ?? {}), ["SOURCE_ROOT"], "No credentials or external demo services")
  const config = JSON.parse(readFileSync(new URL(`containers/${worker.name}-workspace/container.config.json`, output), "utf8"))
  const image = JSON.parse(execFileSync("docker", ["image", "inspect", config.images.workspace.localReference], { encoding: "utf8" }))[0]
  assert.equal(image.Config.User, "node")
  assert.match(image.Id, /^sha256:[a-f0-9]{64}$/)
  const root = mkdtempSync(join(tmpdir(), "effect-ci-snapshot-image-"))
  try {
    chmodSync(root, 0o755)
    mkdirSync(join(root, "dist"))
    const data = new Uint8Array([0, 255, 10, 42])
    writeFileSync(join(root, "dist/binary.dat"), data)
    const patterns = ["dist/**"]
    const [binary, ...command] = outputManifestCommand(patterns)
    const raw = execFileSync("docker", ["run", "--rm", "--platform", "linux/amd64", "--network", "none", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "256m", "--pids-limit", "64",
      "--mount", `type=bind,source=${root},target=/workspace/output,readonly`, "--workdir", "/workspace/output",
      "--entrypoint", binary!, image.Id, ...command], { encoding: "utf8", timeout: 20_000 })
    assert.deepEqual(parseOutputManifest(raw, patterns).files, [{ path: "dist/binary.dat", size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"), executable: false }])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
