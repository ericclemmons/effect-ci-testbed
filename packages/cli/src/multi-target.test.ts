import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { main, type Invocation } from "./index.ts"

const capture = async (run: () => Promise<number>) => {
  const lines: string[] = []
  const old = process.stdout.write
  process.stdout.write = ((line: string | Uint8Array) => {
    lines.push(String(line))
    return true
  }) as typeof process.stdout.write
  try { return { code: await run(), output: JSON.parse(lines.join("")) } }
  finally { process.stdout.write = old }
}

test("multiple selected goals fan out, share prerequisites once, and do not invoke the default", { timeout: 5000 }, async () => {
  const calls: string[] = []
  let release!: () => void
  const both = new Promise<void>(resolve => { release = resolve })
  const setup = CI.action<void>("setup", () => () => Effect.sync(() => { calls.push("setup") }))
  const goal = (name: string) => CI.action<void>(name, function* () {
    yield* setup()
    return () => Effect.promise(async () => {
      calls.push(name)
      if (calls.includes("test") && calls.includes("build")) release()
      await both
    })
  })
  const program = {
    workflow: CI.workflow("project", () => Effect.die("default must not run")),
    actions: { test: goal("test"), build: goal("build") },
  }
  const result = await capture(() => main(program, ["run", "test", "build", "test", "--format=json"]))
  assert.equal(result.code, 0)
  assert.deepEqual(result.output.targets, ["test", "build"])
  assert.equal(result.output.workflow, "project/test+build")
  assert.deepEqual([...calls].sort(), ["build", "setup", "test"])
  for (const id of ["test", "build"]) {
    assert.deepEqual(result.output.plan.nodes.find((n: CI.PlanNode) => n.id === id).dependencies, ["setup"])
  }
})

test("all targets are validated before execution; list and excessive selections reject", async () => {
  let called = false
  const known = CI.action<void>("known", () => () => Effect.sync(() => { called = true }))
  const program = { workflow: CI.workflow("project", known), actions: { known } }
  for (const args of [["run", "known", "missing"], ["list", "known"], ["run", ...Array(33).fill("known")]]) {
    const result = await capture(() => main(program, [...args, "--format=json"]))
    assert.equal(result.code, 2)
    assert.equal(result.output.ok, false)
    assert.equal(called, false)
  }
})

test("custom remote receives the complete selection, while single-target output stays compatible", async () => {
  const action = (name: string) => CI.action<void>(name, () => () => Effect.void)
  const requests: Invocation[] = []
  const program = {
    workflow: CI.workflow("project", () => Effect.void),
    actions: { test: action("test"), build: action("build") },
    remote: async (request: Invocation) => { requests.push(request); return { accepted: true } },
  }
  for (const command of ["run", "plan"]) {
    const result = await capture(() => main(program, [command, "test", "build", "--remote", "--format=json"]))
    assert.equal(result.code, 0)
    assert.deepEqual(requests.at(-1)?.targets, ["test", "build"])
    assert.equal(requests.at(-1)?.target, undefined)
  }
  const single = await capture(() => main(program, ["plan", "test", "--format=json"]))
  assert.equal(single.output.target, "test")
  assert.equal(single.output.targets, undefined)
})
