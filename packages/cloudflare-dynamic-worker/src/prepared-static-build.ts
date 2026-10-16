import { readBoundedText } from "./project-protocol.ts"

export const staticBuildPolicy = Object.freeze({
  tool: "sucrase-3.35.1-typescript" as const, compatibilityDate: "2026-10-07",
  maxSourceBytes: 32 * 1024, maxOutputBytes: 32 * 1024,
  maxToolModules: 32, maxToolBytes: 1024 * 1024, cpuMs: 1000, timeoutMs: 5000,
})
const encoder = new TextEncoder()
const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("")

export function validateStaticBuildSource(source: unknown): string {
  if (typeof source !== "string" || source.includes("\0") || encoder.encode(source).length > staticBuildPolicy.maxSourceBytes)
    throw Error("Invalid static build source")
  return source
}
/** Host-prepared pinned compiler only. This argument is never event/project input. */
export interface PreparedStaticCompiler {
  readonly mainModule: string
  readonly modules: Readonly<Record<string, string | { js?: string }>>
}
export interface StaticBuildResult {
  readonly runtime: "dynamic-worker"
  readonly tool: typeof staticBuildPolicy.tool
  readonly containers: 0
  readonly code: string
  readonly sourceDigest: string
  readonly outputDigest: string
  readonly toolDigest: string
}

/** Parse/transform source as DATA in a fresh child; never import/evaluate project code. */
export async function runPreparedStaticBuild(loader: WorkerLoader, trusted: PreparedStaticCompiler, input: unknown): Promise<StaticBuildResult> {
  const source = validateStaticBuildSource(input), modules: Record<string, string> = Object.create(null)
  const entries = Object.entries(trusted.modules)
  if (!entries.length || entries.length > staticBuildPolicy.maxToolModules || !Object.hasOwn(trusted.modules, trusted.mainModule))
    throw Error("Invalid host compiler bundle")
  let bytes = 0
  for (const [path, value] of entries) {
    const code = typeof value === "string" ? value : value.js
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.js$/.test(path) || path.split("/").some(p => p === "." || p === "..") || typeof code !== "string")
      throw Error("Invalid host compiler bundle")
    bytes += encoder.encode(code).length
    if (bytes > staticBuildPolicy.maxToolBytes) throw Error("Host compiler bundle exceeds limit")
    modules[path] = code
  }
  const toolDigest = await sha256(encoder.encode(JSON.stringify([trusted.mainModule,
    Object.entries(modules).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)])))
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const child = loader.load({ compatibilityDate: staticBuildPolicy.compatibilityDate, compatibilityFlags: [],
      mainModule: trusted.mainModule, modules, env: {}, globalOutbound: null,
      limits: { cpuMs: staticBuildPolicy.cpuMs, subRequests: 0 } }).getEntrypoint()
    const text = await Promise.race([
      (async () => {
        const response = await child.fetch(new Request("https://compiler.invalid/transform", {
          method: "POST", body: source, signal: abort.signal,
        }))
        if (response.status !== 200) { await response.body?.cancel(); throw Error("Compiler failed") }
        return readBoundedText(response, staticBuildPolicy.maxOutputBytes * 6 + 128)
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(Error("Compiler deadline exceeded")) }, staticBuildPolicy.timeoutMs) }),
    ])
    const output: unknown = JSON.parse(text)
    if (!output || typeof output !== "object" || Array.isArray(output) || Object.keys(output).join(",") !== "code")
      throw Error("Invalid compiler output")
    const code = (output as { code: unknown }).code
    if (typeof code !== "string" || code.includes("\0") || encoder.encode(code).length > staticBuildPolicy.maxOutputBytes)
      throw Error("Invalid compiler output")
    return { runtime: "dynamic-worker", tool: staticBuildPolicy.tool, containers: 0, code,
      sourceDigest: await sha256(encoder.encode(source)), outputDigest: await sha256(encoder.encode(code)), toolDigest }
  } catch { throw Error("Static build failed; no output authorized for publication") }
  finally { if (timer !== undefined) clearTimeout(timer); abort.abort() }
}
