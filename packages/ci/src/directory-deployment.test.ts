import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync, symlinkSync, chmodSync, readdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import * as CI from "./index.ts"
import * as Effect from "effect/Effect"
import { directoryDeployment } from "./directory-deployment.ts"

test("workspace.changed compares real bytes with a successful persisted local deployment", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-deployment-"))
  try {
    const project = join(root, "project"), destination = join(root, "production")
    mkdirSync(join(project, "dist"), { recursive: true })
    writeFileSync(join(project, "dist/app.js"), "first output")
    let publishes = 0
    const run = async () => {
      // A new host adapter per run must see persisted success, not a memory cache.
      const deployment = directoryDeployment({ directory: destination, paths: ["dist/**"] })
      const build = CI.action("build", () => function* () { return CI.Workspace.local(project) })
      const publish = CI.action("deploy", () => function* () {
        const workspace = yield* build()
        publishes++
        yield* deployment.publish(workspace)
        return workspace
      })
      const workflow = CI.workflow("site", function* () {
        const workspace = yield* build()
        if (yield* workspace.changed("dist/**")) return yield* publish()
        return workspace
      })
      await CI.runPromise(workflow, { output: "silent", workspaceChanges: deployment.changes })
      return deployment
    }
    const first = await run()
    assert.equal(new TextDecoder().decode(await Effect.runPromise(first.read("dist/app.js"))), "first output")
    await run()
    assert.equal(publishes, 1)
    writeFileSync(join(project, "dist/app.js"), "new output")
    const changed = await run()
    assert.equal(publishes, 2)
    assert.equal(new TextDecoder().decode(await Effect.runPromise(changed.read("dist/app.js"))), "new output")
    assert.ok(readFileSync(join(destination, "current.json"), "utf8").includes('"version":1'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("shared-package builds, failed publication, deletions and separate targets use content identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-output-build-"))
  try {
    const project = join(root, "project"), production = join(root, "production"), staging = join(root, "staging")
    mkdirSync(project)
    const app = "import {message} from './shared.mjs'; export const output = '<h1>'+message+'</h1>';"
    writeFileSync(join(project, "app.mjs"), app)
    writeFileSync(join(project, "shared.mjs"), "export const message = 'first';")
    writeFileSync(join(project, "build.mjs"), "import{mkdirSync,writeFileSync}from'node:fs';import{output}from'./app.mjs';mkdirSync('dist',{recursive:true});writeFileSync('dist/index.html',output);")
    const build = () => execFileSync(process.execPath, ["build.mjs"], { cwd: project, env: {} })
    const workspace = CI.Workspace.local(project)
    const deploy = (destination: ReturnType<typeof directoryDeployment>) => CI.runPromise(CI.workflow("publish", () => destination.publish(workspace)), { output: "silent" })
    const changed = (destination: ReturnType<typeof directoryDeployment>, output = workspace) =>
      CI.runPromise(CI.workflow("changed", () => output.changed("dist/**")), { output: "silent", workspaceChanges: destination.changes }).then(result => result.value)
    const prod = directoryDeployment({ directory: production, paths: ["dist/**"] })
    const stage = directoryDeployment({ directory: staging, paths: ["dist/**"] })
    build(); await deploy(prod)
    const first = readFileSync(join(production, "current.json"), "utf8")
    assert.equal(await changed(prod), false)
    writeFileSync(join(project, "shared.mjs"), "export const message = 'second';")
    build()
    assert.equal(readFileSync(join(project, "app.mjs"), "utf8"), app)
    assert.equal(await changed(prod), true)
    // A real filesystem refusal, not a successful deployment marked by a mock.
    writeFileSync(join(production, "publication.lock"), "another publisher")
    await assert.rejects(deploy(prod))
    assert.equal(readFileSync(join(production, "current.json"), "utf8"), first)
    build()
    assert.equal(await changed(prod), true)
    unlinkSync(join(production, "publication.lock"))
    await deploy(prod)
    assert.equal(await changed(prod), false)
    assert.equal(await changed(stage), true)
    build()
    assert.equal(await changed(prod, workspace.withRevision({ provider: "local", value: "a-new-build-id" })), false)
    const newPolicy = directoryDeployment({ directory: production, paths: ["dist/**"], configuration: "new-serving-policy" })
    assert.equal(await changed(newPolicy), true)
    writeFileSync(join(project, "dist/old.js"), "obsolete")
    await deploy(prod)
    unlinkSync(join(project, "dist/old.js"))
    assert.equal(await changed(prod), true)
    await deploy(prod)
    assert.equal(await Effect.runPromise(prod.read("dist/old.js")), undefined)
    assert.equal(await changed(prod), false)
    chmodSync(join(project, "dist/index.html"), 0o755)
    assert.equal(await changed(prod), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("remote workspaces, corrupt baselines and symlinks cannot authorize skipping", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-output-invalid-"))
  try {
    const project = join(root, "project"), target = join(root, "target")
    mkdirSync(join(project, "dist"), { recursive: true })
    writeFileSync(join(project, "dist/app.js"), "bytes")
    const destination = directoryDeployment({ directory: target, paths: ["dist/**"] })
    const workspace = CI.Workspace.local(project)
    const changed = (value = workspace) => CI.runPromise(CI.workflow("invalid-baseline", () => value.changed("dist/**")),
      { output: "silent", workspaceChanges: destination.changes }).then(result => result.value)
    await CI.runPromise(CI.workflow("publish", () => destination.publish(workspace)), { output: "silent" })
    assert.equal(await changed(CI.Workspace.remote("foreign", project)), true)
    const receipt = JSON.parse(readFileSync(join(target, "current.json"), "utf8"))
    writeFileSync(join(target, "versions", receipt.id, "files/dist/app.js"), "tampered")
    assert.equal(await changed(), true)
    const other = join(root, "elsewhere")
    mkdirSync(other)
    unlinkSync(join(project, "dist/app.js"))
    symlinkSync(other, join(project, "dist/link"))
    await assert.rejects(CI.runPromise(CI.workflow("publish", () => destination.publish(workspace)), { output: "silent" }))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a symlinked destination versions directory cannot redirect publication", async () => {
  const root = mkdtempSync(join(tmpdir(), "effect-ci-output-target-"))
  try {
    const project = join(root, "project"), target = join(root, "target"), outside = join(root, "outside")
    mkdirSync(join(project, "dist"), { recursive: true })
    mkdirSync(target)
    mkdirSync(outside)
    writeFileSync(join(project, "dist/app.js"), "bytes")
    symlinkSync(outside, join(target, "versions"))
    const destination = directoryDeployment({ directory: target, paths: ["dist/**"] })
    await assert.rejects(CI.runPromise(CI.workflow("publish", () => destination.publish(CI.Workspace.local(project))), { output: "silent" }))
    assert.deepEqual(readdirSync(outside), [])
    assert.equal(existsSync(join(target, "current.json")), false)
    assert.equal(existsSync(join(target, "publication.lock")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
