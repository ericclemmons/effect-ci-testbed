import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("branch checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})

const lane = (name: "release" | "preview") => {
  const undoPrepare = CI.action(`undo ${name} prepare`, function* () {
    const workspace = yield* checkout()
    return () => workspace.exec(`echo '${name}:undo prepare'`)
  })
  const prepare = CI.action(`${name} prepare`, function* () {
    const workspace = yield* checkout()
    return () => workspace.exec(`echo '${name}:prepare'`)
  }, { rollback: undoPrepare })
  const advisory = CI.action(`${name} advisory`, function* () {
    const workspace = yield* prepare()
    return () => workspace.exec(`echo '${name}:advisory'; exit 1`)
  })
  const undoPublish = CI.action(`undo ${name} publish`, function* () {
    const workspace = yield* checkout()
    return () => workspace.exec(`echo '${name}:undo publish'`)
  })
  const publish = CI.action(`${name} publish`, function* () {
    const workspace = yield* prepare()
    const event = yield* CI.WorkflowEvent
    return () => workspace.exec(event.ref === "refs/heads/required-failure"
      ? `echo '${name}:publish'; exit 1`
      : `echo '${name}:publish'`)
  }, { rollback: undoPublish })
  const verify = CI.action(`${name} verify`, function* () {
    const workspace = yield* publish()
    return () => workspace.exec(`echo '${name}:verify'`)
  })
  return [prepare(), CI.optional(advisory()), publish(), verify()]
}

export const release = lane("release")
export const preview = lane("preview")

export const report = CI.action("branch report", function* () {
  const workspace = yield* checkout()
  return () => workspace.exec("echo 'branch:report'")
})
