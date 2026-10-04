import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import test from "node:test"

const exec = promisify(execFile)
const fixtureModules = new URL("../../../app/node_modules", import.meta.url)
const vp = new URL("../../../app/node_modules/.bin/vp", import.meta.url)

test("Vite+ learns task inputs and outputs without watchlists", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-ci-vite-tracking-"))

  try {
    await mkdir(join(root, "src"))
    await symlink(fixtureModules, join(root, "node_modules"), "dir")
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "automatic-data-tracking",
      private: true,
      type: "module",
    }))
    await writeFile(join(root, "vite.config.ts"), `
      import { defineConfig } from "vite-plus"

      export default defineConfig({
        run: { tasks: { build: "sh build.sh" } },
      })
    `)
    await writeFile(join(root, "build.sh"), `
      tr '[:lower:]' '[:upper:]' < src/input.txt > output.txt
    `)
    await writeFile(join(root, "src/input.txt"), "first\n")
    await writeFile(join(root, "unrelated.txt"), "one\n")

    const run = async (): Promise<string> => {
      const result = await exec(vp.pathname, ["run", "build"], { cwd: root })

      return result.stdout + result.stderr
    }

    await run()
    assert.equal(await readFile(join(root, "output.txt"), "utf8"), "FIRST\n")

    await rm(join(root, "output.txt"))
    assert.match(await run(), /cache hit/)
    assert.equal(await readFile(join(root, "output.txt"), "utf8"), "FIRST\n")

    await writeFile(join(root, "unrelated.txt"), "two\n")
    assert.match(await run(), /cache hit/)

    await writeFile(join(root, "src/input.txt"), "second\n")
    assert.doesNotMatch(await run(), /cache hit/)
    assert.equal(await readFile(join(root, "output.txt"), "utf8"), "SECOND\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
