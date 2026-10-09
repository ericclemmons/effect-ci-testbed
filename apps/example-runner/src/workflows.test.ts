import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"

import nodeNpm from "../../../examples/node-npm/.cloudflare/ci/workflow.ts"
import nodePnpm from "../../../examples/node-pnpm/.cloudflare/ci/workflow.ts"
import optionalChecks from "../../../examples/optional-checks/.cloudflare/ci/workflow.ts"
import workspace from "../../../examples/cloudflare-runner/.cloudflare/ci/workflow.ts"
import pythonToolchain from "../../../examples/cloudflare-toolchain/.cloudflare/ci/workflow.ts"
import systemPackage from "../../../examples/system-package/.cloudflare/ci/workflow.ts"
import vitePlusCache from "../../../examples/vite-plus-cache/.cloudflare/ci/workflow.ts"
import turborepoCache from "../../../examples/turborepo-cache/.cloudflare/ci/workflow.ts"
import customRunnerImage from "../../../examples/custom-runner-image/.cloudflare/ci/workflow.ts"
import snapshotFanout from "../../../examples/snapshot-fanout/.cloudflare/ci/workflow.ts"
import nodeVersion from "../../../examples/node-version/.cloudflare/ci/workflow.ts"
import miseToolchain from "../../../examples/mise-toolchain/.cloudflare/ci/workflow.ts"
import exportedActions from "../../../examples/exported-actions/.cloudflare/ci/workflow.ts"
import deployHook from "../../../examples/deploy-hook/.cloudflare/ci/workflow.ts"
import sourceChecks from "../../../examples/dynamic-worker-checks/.cloudflare/ci/workflow.ts"

for (const [name, workflow, expected] of [
  ["npm", nodeNpm, ["checkout", "install", "lint", "test", "build"]],
  ["pnpm", nodePnpm, ["checkout", "install", "lint", "format", "test", "build"]],
  ["optional checks", optionalChecks, ["checkout", "install", "lint", "format"]],
  ["workspace", workspace, ["checkout", "install", "build"]],
  ["python toolchain", pythonToolchain, ["checkout", "prepare python toolchain", "build python package"]],
  ["system package", systemPackage, ["checkout", "install imagemagick", "verify imagemagick"]],
  ["Vite+ cache", vitePlusCache, ["checkout", "install", "build"]],
  ["Turborepo cache", turborepoCache, ["checkout", "install", "build"]],
  ["custom runner image", customRunnerImage, ["checkout", "verify baked-in python"]],
  ["snapshot fanout", snapshotFanout, ["checkout", "prepare", "left", "right"]],
  ["Node version", nodeVersion, ["checkout", "install node", "verify node"]],
  ["Mise toolchain", miseToolchain, ["checkout", "install toolchain", "verify node", "verify python"]],
  ["exported actions", exportedActions, ["checkout", "check"]],
  ["source-only checks", sourceChecks, ["checkout", "format source"]],
] as const) {
  test(`${name} uses the unchanged consumer workflow`, async () => {
    const sourceRoot = new Map<string, string>([
      ["Node version", "node-version"],
      ["Mise toolchain", "mise-toolchain"],
      ["source-only checks", "dynamic-worker-checks"],
    ]).get(name)
    const result = await CI.runPromise<unknown>(workflow, {
      mode: "plan",
      output: "silent",
      event: { type: "workflow_dispatch" },
      ...(sourceRoot ? {
        source: {
          checkout: () => Effect.succeed(CI.Workspace.local(resolve(
            "examples", sourceRoot,
          ))),
        },
      } : {}),
    })

    assert.deepEqual(result.plan.nodes.map((node) => node.id).sort(), [...expected].sort())
    assert.ok(result.plan.nodes.every((node) => node.status === "planned"))
  })
}

test("optional validation checks do not publish unnecessary workspace revisions", async () => {
  const result = await CI.runPromise(optionalChecks, { mode: "plan", output: "silent" })
  assert.equal(result.attempt.outputs.lint, undefined)
  assert.equal(result.attempt.outputs.format, undefined)
})

for (const formatted of [true, false]) {
  test(`source-only formatter ${formatted ? "passes" : "rejects"} without executing container commands`, async () => {
    let commands = 0
    const run = CI.runPromise(sourceChecks, {
      output: "silent",
      source: {
        checkout: () => Effect.succeed(CI.Workspace.remote("fixture", "/project")),
      },
      workspaceFileSystem: {
        readFile: (_, path) => {
          assert.equal(path, "app/src/index.ts")
          return Effect.succeed(formatted ? "const value = 1\n" : "const value=1;\n")
        },
        exists: () => Effect.succeed(true),
      },
      executor: {
        execute: () => {
          commands++
          return Effect.die(new Error("Formatter must not execute in the container"))
        },
      },
    })
    if (formatted) {
      const result = await run
      assert.ok(result.plan.nodes.every((node) => node.status === "complete"))
      assert.ok(result.plan.nodes.every((node) => node.commands.length === 0))
    } else {
      await assert.rejects(run, /is not formatted/)
    }
    assert.equal(commands, 0)
  })
}

for (const event of ["deploy_hook", "deployment", "pull_request"] as const) {
  test(`deployment hook routes ${event} without hiding its condition`, async () => {
    const result = await CI.runPromise(deployHook, {
      ci: true,
      mode: event === "pull_request" ? "execute" : "plan",
      output: "silent",
      event: { type: event },
      source: {
        checkout: () => Effect.succeed(CI.Workspace.local(resolve("examples/deploy-hook"))),
      },
    })
    const deploy = result.plan.nodes.find((node) => node.id === "deploy")!
    assert.ok(deploy.condition)
    if (event === "pull_request") {
      assert.equal(deploy.status, "skipped")
      assert.equal(result.plan.nodes.length, 1)
    } else {
      assert.deepEqual(result.plan.nodes.map((node) => node.id).sort(), ["build", "checkout", "deploy", "install"])
      assert.match(result.plan.nodes.find((node) => node.id === "install")!.commands[0]!.command, /npm ci/)
      assert.equal(deploy.status, "planned")
    }
  })
}

test("deployment hook lockfile installs registry dependencies on a fresh runner", () => {
  const lock = JSON.parse(readFileSync(new URL(
    "../../../examples/deploy-hook/package-lock.json", import.meta.url,
  ), "utf8")) as {
    packages: Record<string, { link?: boolean; resolved?: string }>
  }
  assert.ok(lock.packages["node_modules/cf"])
  assert.ok(lock.packages["node_modules/@cloudflare/vite-plugin"])
  for (const [path, dependency] of Object.entries(lock.packages)) {
    assert.ok(path === "" || path.startsWith("node_modules/"), path)
    assert.notEqual(dependency.link, true, path)
    if (dependency.resolved) assert.match(dependency.resolved, /^https:\/\/registry\.npmjs\.org\//)
  }
})

test("different workflows can run concurrently with the same action name", async () => {
  const left = CI.action<void>("shared", () => function* () {}, { timeout: 100 })
  const right = CI.action<void>("shared", () => function* () {}, { timeout: 200 })
  const options = { mode: "plan", output: "silent" } as const
  const results = await Promise.all([
    CI.runPromise(CI.workflow("left", () => left()), options),
    CI.runPromise(CI.workflow("right", () => right()), options),
    CI.runPromise(CI.workflow("left-again", () => left()), options),
  ])

  assert.deepEqual(results.map((result) => result.plan.nodes[0]!.options.timeout), [100, 200, 100])
})

test("different actions with the same name still fail within one workflow", async () => {
  const left = CI.action<void>("duplicate", () => function* () {})
  const right = CI.action<void>("duplicate", () => function* () {})
  const workflow = CI.workflow("duplicates", function* () {
    yield* left()
    yield* right()
  })

  await assert.rejects(
    CI.runPromise(workflow, { mode: "plan", output: "silent" }),
    /Duplicate CI action id: duplicate/,
  )
})

test("action arguments are scoped to each run, not the lifetime of the Worker", async () => {
  const target = CI.action<string, readonly [string]>("target", () => function* (value) {
    return value
  })
  const options = { output: "silent" } as const
  const first = await CI.runPromise(CI.workflow("first", () => target("warm")), options)
  const second = await CI.runPromise(CI.workflow("second", () => target("offline")), options)
  assert.equal(first.value, "warm")
  assert.equal(second.value, "offline")

  const parallel = await Promise.all([
    CI.runPromise(CI.workflow("third", () => target("left")), options),
    CI.runPromise(CI.workflow("fourth", () => target("right")), options),
  ])
  assert.deepEqual(parallel.map((result) => result.value), ["left", "right"])
})

test("one action still executes only once per workflow", async () => {
  let executions = 0
  const target = CI.action<string, readonly [string]>("memoized", () => function* (value) {
    executions++
    return value
  })
  const result = await CI.runPromise(CI.workflow("memoization", function* () {
    const first = yield* target("first")
    const second = yield* target("second")
    return [first, second]
  }), { output: "silent" })
  assert.deepEqual(result.value, ["first", "first"])
  assert.equal(executions, 1)
})
