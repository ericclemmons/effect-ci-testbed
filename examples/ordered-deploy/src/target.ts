import type * as CI from "@effect-ci-testbed/ci"

export type App = "backend" | "frontend"

export interface PreparedDeployment {
  revision: string
  digests: Record<App, string>
}

export interface DeploymentReceipt {
  app: App
  revision: string
  digest: string
  intent: string
  version: string
  deployment: string
  nativeSequence: number
}

export interface VerifiedDeployment extends DeploymentReceipt {
  verifiedAt: string
}

export interface DeploymentObservation {
  revision: string
  digest: string
  version: string
  deployment: string
  percentage: number
  backendScript?: string
}

export interface DeploymentHost {
  targets: Record<App, { script: string; origin: string }>
  prepare(workspace: CI.Workspace): Promise<PreparedDeployment>
  publish(request: {
    app: App
    workspace: CI.Workspace
    prepared: PreparedDeployment
    intent: string
    prerequisite?: VerifiedDeployment
    signal: AbortSignal
  }): Promise<DeploymentReceipt>
  inspect(receipt: DeploymentReceipt, signal: AbortSignal): Promise<DeploymentObservation>
  record(event: {
    app: App
    intent: string
    phase: "started" | "verified" | "failed"
    receipt?: VerifiedDeployment
  }): Promise<void>
  fetch(request: Request): Promise<Response>
}

function configuration(host: DeploymentHost, prepared: PreparedDeployment) {
  if (!/^[a-f0-9]{40}$/.test(prepared.revision) ||
    ![prepared.digests.backend, prepared.digests.frontend].every(digest => /^[a-f0-9]{64}$/.test(digest)))
    throw Error("Deployment needs immutable source and output digests")
  for (const { script, origin } of Object.values(host.targets)) {
    const url = new URL(origin)
    if (!/^[a-z0-9-]{1,63}$/.test(script) || url.protocol !== "https:" || url.origin !== origin)
      throw Error("Deployment needs a fixed HTTPS target")
  }
  if (host.targets.backend.script === host.targets.frontend.script ||
    host.targets.backend.origin === host.targets.frontend.origin)
    throw Error("Backend and frontend need separate targets")
}

async function health(host: DeploymentHost, app: App, path: string, signal: AbortSignal) {
  const response = await host.fetch(new Request(`${host.targets[app].origin}${path}`, {
    redirect: "error", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  }))
  if (response.status !== 200 || response.redirected ||
    !response.headers.get("content-type")?.includes("application/json")) {
    await response.body?.cancel()
    throw Error(`${app} served health unavailable`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw Error(`${app} served health missing`)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.length
      if (size > 4096) throw Error("Served health response limit exceeded")
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as {
    service?: unknown; revision?: unknown; version?: unknown; message?: unknown
    backend?: { service?: unknown; revision?: unknown; version?: unknown; message?: unknown }
  }
}

async function current(host: DeploymentHost, receipt: DeploymentReceipt, signal: AbortSignal) {
  const observed = await host.inspect(receipt, signal)
  if (observed.version !== receipt.version || observed.deployment !== receipt.deployment ||
    observed.revision !== receipt.revision || observed.digest !== receipt.digest || observed.percentage !== 100 ||
    receipt.app === "frontend" && observed.backendScript !== host.targets.backend.script)
    throw Error(`${receipt.app} immutable source or current allocation mismatch`)
}

export async function deployTarget(host: DeploymentHost, workspace: CI.Workspace,
  prepared: PreparedDeployment, app: App, signal: AbortSignal, prerequisite?: VerifiedDeployment,
): Promise<VerifiedDeployment> {
  configuration(host, prepared)
  if (app === "frontend") {
    if (!prerequisite || prerequisite.app !== "backend" || prerequisite.revision !== prepared.revision ||
      prerequisite.digest !== prepared.digests.backend || !prerequisite.verifiedAt)
      throw Error("Frontend needs the verified backend from this preparation")
    await current(host, prerequisite, signal)
    const served = await health(host, "backend", "/health", signal)
    if (served.service !== "backend" || served.revision !== prepared.revision || served.version !== prerequisite.version)
      throw Error("Backend changed before frontend publication")
  }
  const intent = `${host.targets[app].script}:${prepared.revision}:${prepared.digests[app]}`
  await host.record({ app, intent, phase: "started" })
  try {
    const receipt = await host.publish({ app, workspace, prepared, intent, signal,
      ...(prerequisite === undefined ? {} : { prerequisite }) })
    if (receipt.app !== app || receipt.intent !== intent || receipt.revision !== prepared.revision ||
      receipt.digest !== prepared.digests[app] || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(receipt.version) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(receipt.deployment) || !Number.isSafeInteger(receipt.nativeSequence) ||
      receipt.nativeSequence < 1 || prerequisite && receipt.nativeSequence <= prerequisite.nativeSequence)
      throw Error(`${app} publication receipt mismatch`)
    await current(host, receipt, signal)
    const served = await health(host, app, "/health", signal)
    if (served.service !== app || served.revision !== receipt.revision || served.version !== receipt.version)
      throw Error(`${app} served source identity mismatch`)
    if (app === "frontend") {
      const interaction = await health(host, app, "/api/message", signal)
      if (interaction.service !== "frontend" || interaction.revision !== receipt.revision ||
        interaction.version !== receipt.version || interaction.backend?.service !== "backend" ||
        interaction.backend.revision !== prepared.revision || interaction.backend.version !== prerequisite!.version ||
        interaction.backend.message !== "Hello from the backend API")
        throw Error("Frontend did not consume the verified backend API")
      await current(host, prerequisite!, signal)
    }
    await current(host, receipt, signal)
    const verified = { ...receipt, verifiedAt: new Date().toISOString() }
    await host.record({ app, intent, phase: "verified", receipt: verified })
    return verified
  } catch (error) {
    await host.record({ app, intent, phase: "failed" })
    throw error
  }
}
