import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import * as actions from "../actions.ts"
import { local } from "../local.ts"

const root = fileURLToPath(new URL("../../../../../", import.meta.url))
const recipe = join(root, "examples/snapshot-fanout")

test("the real CLI fans out from one snapshot without modifying the checkout", () => {
  const directory = mkdtempSync(join(tmpdir(), "effect-ci-fanout-cli-"))
  try {
    mkdirSync(join(directory, ".cloudflare/ci"), { recursive: true })
    for (const file of ["workflow.ts", "actions.ts", "local.ts"])
      cpSync(join(recipe, ".cloudflare/ci", file), join(directory, ".cloudflare/ci", file))
    cpSync(join(recipe, "app"), join(directory, "app"), { recursive: true })
    writeFileSync(join(directory, "package.json"), '{"type":"module"}')
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "dir")
    const planned = spawnSync(process.execPath, [join(root, "packages/cli/src/effect-ci.ts"),
      "--workflow", join(directory, ".cloudflare/ci/workflow.ts"), "plan", "--format=json"], {
      encoding: "utf8", timeout: 15000,
    })
    assert.equal(planned.status, 0, planned.stdout + planned.stderr)
    assert.equal(existsSync(join(directory, "app/prepared.txt")), false)
    const result = spawnSync(process.execPath, [join(root, "packages/cli/src/effect-ci.ts"),
      "--workflow", join(directory, ".cloudflare/ci/workflow.ts"), "run", "--format=json"], {
      encoding: "utf8", timeout: 15000,
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const output = JSON.parse(result.stdout)
    for (const id of ["checkout", "prepare", "left", "right"]) {
      const nodes = output.plan.nodes.filter((node: { id: string }) => node.id === id)
      assert.equal(nodes.length, 1, `${id} executes once`)
      assert.equal(nodes[0].status, "complete")
    }
    for (const path of ["prepared.txt", "branch.txt"]) {
      assert.equal(existsSync(join(directory, "app", path)), false, `checkout unchanged: ${path}`)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("both branches preserve their own result and leave the prepared snapshot unchanged", async () => {
  const runner = local({ root: recipe })
  try {
    const proof = CI.workflow("fanout-snapshot-proof", function* () {
      const prepared = yield* actions.prepare()
      yield* CI.parallel([actions.left(), actions.right()])
      // Reading completed action values reuses them; it must not execute again.
      const left = yield* actions.left()
      const right = yield* actions.right()
      return { prepared, left, right }
    })
    const { value, plan } = await CI.runPromise(proof, { ...runner, output: "silent" })
    const read = (workspace: CI.Workspace, path: string) =>
      Effect.runPromise(runner.workspaceFileSystem!.readFile(workspace, path, "inspect"))
    assert.equal(await read(value.prepared, "prepared.txt"), "prepared")
    assert.equal(await read(value.prepared, "branch.txt"), undefined)
    assert.equal(await read(value.left, "branch.txt"), "left")
    assert.equal(await read(value.right, "branch.txt"), "right")
    assert.notDeepEqual(value.left.revision, value.right.revision)
    assert.equal(plan.nodes.filter(node => node.id === "prepare").length, 1)
    await assert.rejects(read(CI.Workspace.remote("another-run", "/workspace"), "input.txt"),
      /does not belong/)
  } finally {
    await runner.dispose?.()
  }
})

test("a checkpoint restores its captured bytes rather than later writes", async () => {
  const runner = local({ root: recipe })
  try {
    const restore = CI.action("restore", () => function* () {
      const workspace = yield* actions.prepare()
      const checkpoint = yield* workspace.checkpoint("prepared")
      yield* workspace.exec("printf overwritten > prepared.txt")
      const restored = yield* checkpoint.restore()
      return yield* restored.exec('test "$(cat prepared.txt)" = prepared')
    })
    await CI.runPromise(CI.workflow("restore-proof", () => restore()), { ...runner, output: "silent" })
  } finally {
    await runner.dispose?.()
  }
})

test("a failed branch remains a failure", async () => {
  const runner = local({ root: recipe })
  try {
    const fail = CI.action("fail", () => function* () {
      const workspace = yield* actions.prepare()
      return yield* workspace.exec("printf real-failure >&2; exit 7")
    })
    await assert.rejects(
      CI.runPromise(CI.workflow("failure-proof", () => fail()), { ...runner, output: "silent" }),
      /Command failed \(7\)/,
    )
  } finally {
    await runner.dispose?.()
  }
})

test("the fixture excludes root metadata and rejects links outside its snapshot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "effect-ci-fanout-inputs-"))
  mkdirSync(join(directory, "app"))
  writeFileSync(join(directory, "app/input.txt"), "public fixture")
  writeFileSync(join(directory, "outside.txt"), "outside fixture")
  writeFileSync(join(directory, ".env"), "nonsecret test sentinel")
  const runner = local({ root: directory })
  try {
    const { value } = await CI.runPromise(CI.workflow("input-proof", () => actions.checkout()),
      { ...runner, output: "silent" })
    const repository = CI.Workspace.remote(value.id!, "/workspace", value.revision)
    assert.equal(await Effect.runPromise(runner.workspaceFileSystem!.readFile(repository, ".env", "inspect")), undefined)
    assert.equal(await Effect.runPromise(runner.workspaceFileSystem!.readFile(value, "input.txt", "inspect")), "public fixture")
    symlinkSync(join(directory, "outside.txt"), join(directory, "app/link"))
    const another = local({ root: directory })
    try {
      await assert.rejects(CI.runPromise(CI.workflow("link-proof", () => actions.checkout()),
        { ...another, output: "silent" }), /require regular files/)
    } finally {
      await another.dispose?.()
    }
  } finally {
    await runner.dispose?.()
    rmSync(directory, { recursive: true, force: true })
  }
})
