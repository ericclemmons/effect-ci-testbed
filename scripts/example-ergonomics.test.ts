import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { build } from "../examples/node-pnpm/.cloudflare/ci/actions.ts"

const cli = (args: string[]) => {
  const result = spawnSync(process.execPath, ["packages/cli/src/effect-ci.ts", "--workflow",
    "examples/node-pnpm/.cloudflare/ci/workflow.ts", ...args, "--format=json"], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

test("transport-cache recipes explicitly select their digest-resolved configured image", () => {
  for (const recipe of ["vite-plus-cache", "turborepo-cache", "cache-policy", "package-manager-cache"]) {
    const worker = readFileSync(new URL(`../examples/${recipe}/src/worker.ts`, import.meta.url), "utf8")
    const config = JSON.parse(readFileSync(new URL(`../examples/${recipe}/wrangler.jsonc`, import.meta.url), "utf8"))
    assert.ok(config.containers.some((container: any) => container.images?.workspace?.dockerfile), recipe)
    assert.match(worker, /container:\s*\{\s*image:\s*"workspace"\s*\}/, recipe)
  }
})

test("root recipe shortcuts execute or plan rather than silently printing help", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  const entries = Object.entries(scripts).filter(([name]) => name.startsWith("ci:"))
  assert.ok(entries.length >= 8)
  for (const [name, command] of entries) assert.match(String(command), /\beffect-ci\b.*\b(?:run|plan)\b/, name)
})

test("the pnpm recipe exposes useful goals, not its internal setup", () => {
  const result = cli(["list"])
  assert.deepEqual(result.targets.map((target: { name: string } | string) => typeof target === "string" ? target : target.name).sort(),
    ["build", "format", "lint", "test"])
})

test("actual recipe actions tolerate optional formatting failure but block test/build after required lint failure", async () => {
  for (const failed of ["format", "lint"]) {
    const commands: string[] = []
    const run = () => CI.runPromise(CI.workflow("recipe-goals", () => build()), {
      output: "silent",
      source: { checkout: () => Effect.succeed(CI.Workspace.local(resolve("examples/node-pnpm"))) },
      executor: { execute: request => {
        commands.push(request.command)
        return Effect.succeed({ exitCode: new RegExp(`run ["']?${failed}["']?$`).test(request.command) ? 1 : 0, stdout: "", stderr: "" })
      } },
    })
    if (failed === "lint") {
      await assert.rejects(run())
      assert.ok(!commands.some(command => /run ["']?(test|build)["']?$/.test(command)))
    } else {
      await run()
      assert.ok(commands.some(command => /run ["']?test["']?$/.test(command)), JSON.stringify(commands))
      assert.ok(commands.some(command => /run ["']?build["']?$/.test(command)), JSON.stringify(commands))
    }
    assert.equal(commands.filter(command => command.includes("install")).length, 1)
  }
})

test("selected recipe goals own validation; callers never need the default workflow's ordering", () => {
  for (const targets of [["test"], ["build"], ["test", "build"]]) {
    const result = cli(["plan", ...targets])
    const nodes = result.plan.nodes as { id: string; dependencies: string[]; optional: boolean }[]
    for (const id of ["checkout", "install", "lint", "format", "test"])
      assert.equal(nodes.filter(node => node.id === id).length, 1, `${targets}: ${id}`)
    assert.ok(nodes.find(node => node.id === "format")!.optional)
    assert.ok(nodes.find(node => node.id === "test")!.dependencies.includes("lint"))
    if (targets.includes("build")) assert.ok(nodes.find(node => node.id === "build")!.dependencies.includes("test"))
    else assert.ok(!nodes.some(node => node.id === "build"))
  }
})
