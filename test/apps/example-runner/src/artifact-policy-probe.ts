import * as CI from "@effect-ci-testbed/ci"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})

const publish = CI.action<CI.WorkspaceArtifact>("publish", function* () {
  const workspace = yield* checkout()
  return function* () {
    const built = yield* workspace.exec("mkdir -p dist && printf artifact-policy > dist/proof.txt")
    return yield* CI.Artifact.publish(built, { name: "proof", paths: ["dist/proof.txt"] })
  }
}, { retries: { limit: 1, delay: 0 }, timeout: 120000 })

const checkpoint = CI.action<CI.WorkspaceCheckpoint>("checkpoint", function* () {
  const artifact = yield* publish()
  return function* () {
    const workspace = yield* CI.Artifact.restore(artifact)
    return yield* workspace.checkpoint("restored-artifact")
  }
}, { timeout: 120000 })

const verify = CI.check("verify", function* () {
  const revision = yield* checkpoint()
  return function* () {
    const workspace = yield* revision.restore()
    yield* workspace.exec('test "$(cat dist/proof.txt)" = artifact-policy && echo artifact-policy-verified')
  }
})

// Host-only adapter regression; no deployment or external side effects.
export default CI.workflow("artifact-policy-probe", () => verify())
