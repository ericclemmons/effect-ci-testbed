import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { cleanCheckoutCommand } from "../../../packages/cloudflare/src/source-checkout.ts"

test("fresh checkout retains only the declared nested task cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-ci-cache-checkout-"))
  try {
    execFileSync("git", ["init", "--quiet", directory])
    await writeFile(join(directory, "source.txt"), "tracked source")
    execFileSync("git", ["-C", directory, "add", "source.txt"])
    const cache = "app/node_modules/.vite/task-cache"
    await mkdir(join(directory, cache), { recursive: true })
    await writeFile(join(directory, cache, "entry"), "cached task")
    await mkdir(join(directory, "app/dist"), { recursive: true })
    await writeFile(join(directory, "app/dist/build.js"), "stale output")
    await mkdir(join(directory, "app/node_modules/dependency"), { recursive: true })
    await writeFile(join(directory, "app/node_modules/dependency/index.js"), "old install")
    const [command, ...args] = cleanCheckoutCommand(directory, [cache])
    execFileSync(command!, [...args])
    assert.equal(await readFile(join(directory, cache, "entry"), "utf8"), "cached task")
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
