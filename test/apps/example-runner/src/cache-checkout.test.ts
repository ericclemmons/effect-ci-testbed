import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { cleanCheckoutCommand } from "../../../../packages/cloudflare/src/source-checkout.ts"
import { taskCachePaths } from "@effect-ci-testbed/ci/task-cache"

test("fresh checkout retains only the declared nested task cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-ci-cache-checkout-"))
  try {
    execFileSync("git", ["init", "--quiet", directory])
    await writeFile(join(directory, "source.txt"), "tracked source")
    await mkdir(join(directory, "app"), { recursive: true })
    await writeFile(join(directory, "app/package.json"), JSON.stringify({ dependencies: { "vite-plus": "1.0.0", turbo: "2.11.6" } }))
    execFileSync("git", ["-C", directory, "add", "."])
    const cache = "app/node_modules/.vite/task-cache"
    await mkdir(join(directory, cache), { recursive: true })
    await writeFile(join(directory, cache, "entry"), "cached task")
    await mkdir(join(directory, "app/.turbo/cache"), { recursive: true })
    await writeFile(join(directory, "app/.turbo/cache/entry"), "cached turbo task")
    await mkdir(join(directory, "app/dist"), { recursive: true })
    await writeFile(join(directory, "app/dist/build.js"), "stale output")
    await mkdir(join(directory, "app/node_modules/dependency"), { recursive: true })
    await writeFile(join(directory, "app/node_modules/dependency/index.js"), "old install")
    const paths = taskCachePaths(directory)
    assert.ok(paths.includes(cache))
    assert.ok(paths.includes("app/.turbo/cache"))
    const [command, ...args] = cleanCheckoutCommand(directory, paths)
    execFileSync(command!, [...args])
    assert.equal(await readFile(join(directory, cache, "entry"), "utf8"), "cached task")
    assert.equal(await readFile(join(directory, "app/.turbo/cache/entry"), "utf8"), "cached turbo task")
    assert.equal(await readFile(join(directory, "source.txt"), "utf8"), "tracked source")
    await assert.rejects(readFile(join(directory, "app/dist/build.js")), { code: "ENOENT" })
    await assert.rejects(readFile(join(directory, "app/node_modules/dependency/index.js")), { code: "ENOENT" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("cache exclusions cannot escape the selected repository", () => {
  for (const path of ["", "/tmp/cache", "../cache", "app/../../cache"]) {
    assert.throws(() => cleanCheckoutCommand("/project", [path]), /relative to the repository/)
  }
})
