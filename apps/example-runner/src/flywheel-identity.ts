import type { CheckCacheRequest } from "@effect-ci-testbed/ci"
import type { HostedCheckIdentity } from "../../../packages/cloudflare/src/check-evidence.ts"

export const repository = "https://github.com/ericclemmons/effect-ci-testbed"
export const fixtureRoot = "examples/release-flywheel"
export const command = "env -i PATH=/usr/local/bin:/usr/bin:/bin node --test worker.test.mjs"
export const runtimeCommand = "env -i PATH=/usr/local/bin:/usr/bin:/bin node -p 'JSON.stringify({node:process.versions.node,v8:process.versions.v8})'"
export const files = ["worker.mjs", "worker.test.mjs"] as const
// Host-owned eligibility for one bounded, dependency-free demo. Changes require reenrollment.
const policy = { version: 1, repository, workflow: "release-flywheel", check: "worker-tests", command,
  files, environment: "empty", dependencies: "none", scope: "commit", runtime: "exact-node-and-v8" }
export const digest = async (text: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join("")
export const policyDigest = () => digest(JSON.stringify(policy))

/** Actual prepared bytes and runtime, never caller-supplied hashes. Only this host's fixed demo is eligible. */
export async function identifyFlywheel(request: CheckCacheRequest,
  read: (path: string) => Promise<string | undefined>, runtime: () => Promise<string>, eligibleSourceDigest: string): Promise<HostedCheckIdentity | undefined> {
  if (request.workflowId !== policy.workflow || request.stepId !== policy.check || request.command !== command ||
      request.policy.scope !== "commit" || request.event.source?.kind !== "git" ||
      request.event.source.repository !== repository || request.event.source.revision !== request.event.revision ||
      !/^[0-9a-f]{40}$/.test(request.event.revision ?? "")) return undefined
  const contents: Array<readonly [string, string]> = []
  for (const file of files) {
    const text = await read(file)
    if (text === undefined || new TextEncoder().encode(text).length > 65_536) return undefined
    contents.push([file, text])
  }
  const sourceDigest = await digest(JSON.stringify(contents))
  if (sourceDigest !== eligibleSourceDigest) return undefined
  const version = JSON.parse(await runtime()) as { node?: unknown; v8?: unknown }
  if (typeof version.node !== "string" || !/^24\.\d+\.\d+$/.test(version.node) ||
      typeof version.v8 !== "string" || version.v8.length > 100) return undefined
  return { kind: "check", repository, revision: request.event.revision!, workflowId: policy.workflow,
    stepId: policy.check, command, policyDigest: await policyDigest(),
    sourceDigest,
    toolchainDigest: await digest(JSON.stringify({ node: version.node, v8: version.v8 })) }
}

export interface BuildReceipt { readonly version: string; readonly revision: string; readonly moduleDigest: string; readonly signature: string }
export const buildBytes = (receipt: Omit<BuildReceipt, "signature">) => new TextEncoder().encode(JSON.stringify([
  "effect-ci-flywheel-build", 1, "effect-ci-hmd-demo", receipt.version, receipt.revision, receipt.moduleDigest,
]))
export async function verifyBuild(receipt: BuildReceipt, revision: string, module: string, publicKey: CryptoKey) {
  if (!receipt || !/^[0-9a-f-]{36}$/.test(receipt.version) || receipt.revision !== revision ||
      receipt.moduleDigest !== await digest(module) || !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)) return false
  try {
    const signature = Uint8Array.from(atob(receipt.signature.replace(/-/g, "+").replace(/_/g, "/") + "=="), c => c.charCodeAt(0))
    return await crypto.subtle.verify("Ed25519", publicKey, signature, buildBytes(receipt))
  } catch { return false }
}
