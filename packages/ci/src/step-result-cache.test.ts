import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "./index.ts"
import * as Effect from "effect/Effect"

test("a completed workspace result supplies artifacts to a later run without rebuilding prerequisites", async () => {
  let preparations = 0, builds = 0, publishes = 0, owner = "first"
  let stored: CI.WorkspaceCheckpointHandle | undefined
  const prepare = CI.action("install", () => function* () {
    preparations++
    return CI.Workspace.remote(owner, "/workspace/repository")
  })
  const build = CI.action("build", function* () {
    const workspace = yield* prepare()
    return function* () { builds++; return workspace }
  })
  const publish = CI.action<string | undefined>("publish", () => function* () {
    const workspace = yield* build()
    publishes++
    return yield* workspace.readFile("dist/app.js")
  })
  const cache: CI.StepResultCache = {
    lookup: request => Effect.sync(() => request.stepId === "build" && stored
      ? { value: CI.Workspace.remote(owner, "/workspace/repository", stored) } : undefined),
    record: (request, value) => Effect.sync(() => {
      if (request.stepId !== "build") return
      assert.ok(value instanceof CI.Workspace)
      assert.equal(value.revision?.value, "completed-build-snapshot", "record must follow workspace commit")
      stored = value.revision
    }),
  }
  for (owner of ["first", "second"]) {
    const result = await CI.runPromise(CI.workflow("artifact-result", () => publish()), {
      output: "silent", stepResultCache: cache,
      workspacePersistence: {
        commit: request => Effect.succeed(request.workspace.withRevision({ provider: "test", value: request.stepId === "build" ? "completed-build-snapshot" : "install-snapshot" })),
        checkpoint: () => Effect.die("not used"), restore: () => Effect.die("not used"),
      },
      workspaceFileSystem: { exists: () => Effect.succeed(true), readFile: workspace => Effect.sync(() => {
        assert.equal(workspace.id, owner, "hydrate into the receiving run, not the producing run")
        assert.equal(workspace.revision?.value, "completed-build-snapshot")
        return "actual artifact bytes"
      }) },
    })
    assert.equal(result.value, "actual artifact bytes")
    assert.equal(result.plan.nodes.find(node => node.id === "build")?.status, owner === "first" ? "complete" : "reused")
  }
  assert.equal(preparations, 1); assert.equal(builds, 1); assert.equal(publishes, 2)
})

test("lookup/record outages are misses; failed execution or failed commit never records a completed result", async () => {
  let records = 0, bodies = 0
  for (const failure of ["lookup", "body", "commit", "record"] as const) {
    const action = CI.action("build", () => function* () {
      bodies++
      if (failure === "body") throw Error("build failed")
      return CI.Workspace.local("/fixture")
    })
    const run = () => CI.runPromise(CI.workflow("failures", () => action()), {
      output: "silent",
      stepResultCache: {
        lookup: () => failure === "lookup" ? Effect.fail(Error("store offline")) : Effect.succeed(undefined),
        record: () => Effect.suspend(() => { records++; return failure === "record" ? Effect.fail(Error("write offline")) : Effect.void }),
      },
      workspacePersistence: { commit: ({ workspace }) => failure === "commit" ? Effect.fail(Error("commit failed")) : Effect.succeed(workspace),
        checkpoint: () => Effect.die("not used"), restore: () => Effect.die("not used") },
    })
    if (failure === "body" || failure === "commit") await assert.rejects(run())
    else await run()
  }
  assert.equal(bodies, 4); assert.equal(records, 2)
})

test("undefined is a reusable result; planning never consults or writes the store", async () => {
  let bodies = 0, reads = 0, writes = 0
  const action = CI.action<void>("check", () => function* () { bodies++; return undefined })
  const workflow = CI.workflow("void-result", () => action())
  const cache: CI.StepResultCache = { lookup: () => Effect.sync(() => { reads++; return { value: undefined } }),
    record: () => Effect.sync(() => { writes++ }) }
  const run = await CI.runPromise(workflow, { output: "silent", stepResultCache: cache })
  assert.equal(run.value, undefined); assert.equal(run.plan.nodes[0]?.status, "reused")
  await CI.runPromise(workflow, { mode: "plan", output: "silent", stepResultCache: cache })
  assert.equal(reads, 1); assert.equal(writes, 0); assert.equal(bodies, 1)
})
