import { DurableObject } from "cloudflare:workers"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as CI from "@effect-ci-testbed/ci"
import { pathPatterns } from "@effect-ci-testbed/ci/paths"
import { outputManifestDigest, parseOutputManifest, type OutputManifest } from "./output-manifest.ts"
import type { Runner } from "./index.ts"
import type { RunnerWorkspaceResult } from "./runner-step-result.ts"

interface DeploymentOutput {
  readonly snapshot: RunnerWorkspaceResult
  readonly manifest: OutputManifest
  /** Non-secret identity of a completed deployment, checked against the target. */
  readonly receipt: string
}
export interface SnapshotDeploymentBaseline extends DeploymentOutput {
  readonly generation: string
  readonly digest: string
}
export interface SnapshotBaselineStore {
  readonly current: (scope: string) => Promise<SnapshotDeploymentBaseline | undefined>
  readonly record: (scope: string, expected: string | undefined, output: DeploymentOutput) => Promise<boolean>
}
export interface DeploymentVerification {
  readonly destination: string
  readonly configuration: string
  readonly receipt: string
  readonly manifest: OutputManifest
  readonly digest: string
}
const key = (value: string) => {
  if (!/^[a-f0-9]{64}$/.test(value)) throw Error("Invalid deployment scope")
  return `deployment:${value}`
}
const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(JSON.stringify(value)))), b => b.toString(16).padStart(2, "0")).join("")

/** Private destination state. It has no HTTP, deployment or signing authority. */
export class SnapshotDeploymentBaselines extends DurableObject {
  async current(scope: string): Promise<SnapshotDeploymentBaseline | undefined> {
    return this.ctx.storage.get(key(scope))
  }
  async record(scope: string, expected: string | undefined, output: DeploymentOutput): Promise<boolean> {
    const storageKey = key(scope)
    if (typeof output.receipt !== "string" || !output.receipt || output.receipt.length > 4096 || /[\x00-\x1f]/.test(output.receipt))
      throw Error("Invalid successful deployment receipt")
    if (output.snapshot?.kind !== "workspace" || output.snapshot.provider !== "cloudflare-container" || !output.snapshot.snapshot?.id)
      throw Error("Invalid deployment snapshot")
    const manifest = parseOutputManifest(JSON.stringify(output.manifest), output.manifest.patterns)
    const value: SnapshotDeploymentBaseline = { snapshot: structuredClone(output.snapshot), manifest, receipt: output.receipt,
      generation: crypto.randomUUID(), digest: await outputManifestDigest(manifest) }
    return this.ctx.storage.transaction(async tx => {
      const existing = await tx.get<SnapshotDeploymentBaseline>(storageKey)
      if (existing?.generation !== expected) return false
      await tx.put(`${storageKey}:history:${value.generation}`, value)
      await tx.put(storageKey, value)
      return true
    })
  }
  fetch() { return new Response("Not found", { status: 404 }) }
}

/** Host configuration, not another deployment controller. The existing deploy
 * action calls recordSuccessful only after it has completed and verified its
 * own effects. Snapshot creation, build success and previews are not success.
 */
export function snapshotDeployment(options: {
  readonly destination: string
  readonly patterns: ReadonlyArray<string>
  readonly configuration: string
  readonly runner: Pick<Runner, "outputs">
  readonly baselines: SnapshotBaselineStore
  /** Independently check current target, serving policy AND deployed bytes. */
  readonly verifyCurrent: (request: DeploymentVerification) => Promise<boolean>
}) {
  if (!options.destination || options.destination.length > 1024 || !options.configuration || options.configuration.length > 4096)
    throw Error("A deployment needs a destination and configuration identity")
  const patterns = pathPatterns(options.patterns)
  const scope = digest(["snapshot-deployment-v1", options.destination, patterns, options.configuration])
  const verify = (receipt: string, manifest: OutputManifest, digest: string) => Effect.tryPromise({
    try: () => options.verifyCurrent({ destination: options.destination, configuration: options.configuration, receipt, manifest, digest }),
    catch: error => error,
  })
  const changes: CI.WorkspaceChangeProvider = { changed: request => Effect.gen(function* () {
    if (JSON.stringify(pathPatterns(request.patterns)) !== JSON.stringify(patterns)) return undefined
    const baseline = yield* Effect.tryPromise({ try: async () => options.baselines.current(await scope), catch: error => error })
    if (!baseline) return true
    // Re-read the saved artifact in a separate inspection workspace. A stored
    // manifest alone cannot establish that the snapshot is still available.
    const prior = yield* options.runner.outputs.read(baseline.snapshot, patterns)
    if ((yield* Effect.tryPromise(() => outputManifestDigest(prior))) !== baseline.digest) return undefined
    if ((yield* verify(baseline.receipt, prior, baseline.digest)) !== true) return true
    const current = yield* options.runner.outputs.inspect(request.workspace, patterns)
    return (yield* Effect.tryPromise(() => outputManifestDigest(current.manifest))) !== baseline.digest
  }) }
  return {
    changes,
    recordSuccessful: (workspace: CI.Workspace, receipt: string) => Effect.gen(function* () {
      if ((yield* CI.executionMode) === "plan") return false
      const storageKey = yield* Effect.tryPromise(() => scope)
      const previous = yield* Effect.tryPromise(() => options.baselines.current(storageKey))
      const output = yield* options.runner.outputs.inspect(workspace, patterns)
      const outputDigest = yield* Effect.tryPromise(() => outputManifestDigest(output.manifest))
      if ((yield* verify(receipt, output.manifest, outputDigest)) !== true) return false
      return yield* Effect.tryPromise(() => options.baselines.record(storageKey, previous?.generation, { ...output, receipt }))
    }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause)
      ? Effect.failCause(Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason))) : Effect.succeed(false))),
  }
}
