import { fileURLToPath } from "node:url"
import * as Effect from "effect/Effect"
import { projectPolicy, validateProject } from "./project-protocol.ts"
import type { ProjectChecksService, ProjectResult } from "./project-service.ts"

export class LocalIsolateUnavailable extends Error {
  readonly code = "CI_LOCAL_ISOLATE_UNAVAILABLE"
  constructor() { super("Local project checks require workerd with WorkerLoader and loopback access. Install the locked workspace dependencies and allow local loopback; project modules will never fall back to Node execution.") }
}
interface Bridge { request(body: string): Promise<{ status: number; text(): Promise<string> }>; dispose(): Promise<void> }
const startBridge = async (): Promise<Bridge> => {
  let runtime: { dispose(): Promise<void> } | undefined
  try {
    const [{ Miniflare, Log, LogLevel }, { build }] = await Promise.all([import("miniflare"), import("esbuild")])
    const bundle = await build({ entryPoints: [fileURLToPath(new URL("./local-bridge.ts", import.meta.url))],
      bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd", "import"],
      external: ["node:*", "cloudflare:workers", "cloudflare:workflows"], logLevel: "silent" })
    const contents = bundle.outputFiles[0]?.text
    if (!contents) throw new Error("Missing trusted bridge bundle")
    const engine = new Miniflare({ log: new Log(LogLevel.NONE),
      // Runtime console events bypass Miniflare's Log level. Never promote
      // untrusted module logs into CLI JSON, host diagnostics or agent instructions.
      handleStructuredLogs: () => {},
      workers: [{ config: {
      name: "effect-ci-local-project", compatibilityDate: "2026-10-07", compatibilityFlags: ["nodejs_compat"],
      env: { LOADER: { type: "worker-loader" } },
      manifest: { mainModule: "bridge.js", modules: { "bridge.js": { type: "esm", contents } } },
    } }] })
    runtime = engine
    const health = await engine.dispatchFetch("https://local-project.invalid/ready")
    if (health.status !== 200 || await health.text() !== "ready") throw new Error("Unsupported WorkerLoader capability")
    return { request: body => engine.dispatchFetch("https://local-project.invalid/check", { method: "POST", body }), dispose: () => engine.dispose() }
  } catch {
    await runtime?.dispose().catch(() => {})
    throw new LocalIsolateUnavailable()
  }
}

/** Lazy, scoped local runtime. Only trusted bridge code is bundled in agent Node. */
export function makeLocalProjectChecks(options: { readonly start?: () => Promise<Bridge> } = {}) {
  let started: Promise<Bridge> | undefined, disposal: Promise<void> | undefined, closed = false
  const dispose = () => {
    closed = true
    return disposal ??= started ? started.then(bridge => bridge.dispose(), () => {}) : Promise.resolve()
  }
  const service: ProjectChecksService = { run: input => Effect.tryPromise({ try: async () => {
    if (closed) throw new Error("Local isolate scope is closed")
    const request = validateProject(input)
    started ??= (options.start ?? startBridge)().catch(() => { throw new LocalIsolateUnavailable() })
    const bridge = await started
    const passed: string[] = []
    for (const check of request.checks) {
      let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false
      try {
        // One assertion per request keeps the outer watchdog per-check too.
        // A stuck local workerd cannot block Node's watchdog or survive scope disposal.
        const result = await Promise.race([
          (async () => {
            const response = await bridge.request(JSON.stringify({ ...request, checks: [check] })), text = await response.text()
            if (text.length > 4096) throw new Error("Invalid local isolate response")
            const value: unknown = JSON.parse(text)
            if (!value || typeof value !== "object") throw new Error("Invalid local isolate response")
            const result = value as Record<string, unknown>
            if (response.status !== 200) throw new Error(result.error === `Project check failed: ${check.name}` ? result.error : "Isolated project assertions failed")
            if (result.runtime !== "dynamic-worker" || result.containers !== 0 || JSON.stringify(result.passed) !== JSON.stringify([check.name])) throw new Error("Invalid local isolate proof")
            return check.name
          })(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => {
            timedOut = true; reject(new Error(`Local project check timed out: ${check.name}; workerd scope terminated`))
          }, projectPolicy.timeoutMs + 1000) }),
        ])
        passed.push(result)
      } catch (error) { if (timedOut) await dispose(); throw error }
      finally { if (timer !== undefined) clearTimeout(timer) }
    }
    return { runtime: "dynamic-worker", containers: 0, passed } as ProjectResult
  }, catch: error => error }) }
  return { service, dispose }
}
