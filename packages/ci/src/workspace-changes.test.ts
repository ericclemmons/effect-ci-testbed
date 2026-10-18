import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "./index.ts"
import * as Effect from "effect/Effect"

test("an ordinary workspace.changed branch uses the selected deployment provider", async () => {
  const workspace = CI.Workspace.local("/project")
  let deployments = 0
  const build = CI.action("build", () => function* () { return workspace })
  const deploy = CI.action<void>("deploy", () => function* () { deployments++ })
  const workflow = CI.workflow("output-change", function* () {
    const output = yield* build()
    if (yield* output.changed("dist/**")) yield* deploy()
  })
  const result = await CI.runPromise(workflow, { output: "silent", workspaceChanges: {
    changed: request => {
      assert.equal(request.workspace, workspace)
      assert.deepEqual(request.patterns, ["dist/**"])
      return Effect.succeed(false)
    },
  } })
  assert.equal(deployments, 0)
  assert.deepEqual(result.plan.nodes.map(node => node.id), ["build"])
})

test("unknown/failing workspace comparisons run work; planning does no comparison IO", async () => {
  const workspace = CI.Workspace.local("/project")
  const workflow = CI.workflow("unknown-output", function* () { return yield* workspace.changed("dist/**") })
  for (const provider of [undefined,
    { changed: () => Effect.succeed(undefined) },
    { changed: () => Effect.fail(Error("offline")) },
    { changed: () => Effect.die(Error("defect")) },
    { changed: () => { throw Error("callback throws") } },
  ]) {
    assert.equal((await CI.runPromise(workflow, { output: "silent", ...(provider ? { workspaceChanges: provider } : {}) })).value, true)
  }
  assert.equal((await CI.runPromise(workflow, { mode: "plan", output: "silent", workspaceChanges: {
    changed: () => Effect.die("planning must not inspect files or deployment state"),
  } })).value, true)
  await assert.rejects(CI.runPromise(workflow, { output: "silent", workspaceChanges: { changed: () => Effect.interrupt } }))
})
