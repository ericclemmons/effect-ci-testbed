import type { ProjectRequest } from "./project-service.ts"
export const projectPolicy = Object.freeze({
  compatibilityDate: "2026-10-07", cpuMs: 50, subRequests: 0,
  maxModules: 16, maxSourceBytes: 64 * 1024, maxChecks: 16,
  maxResponseBytes: 4096, timeoutMs: 5000,
})
const encoder = new TextEncoder()
const validModule = (path: string) => /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.js$/.test(path)
export function validateProject(request: ProjectRequest): ProjectRequest {
  const entries = Object.entries(request.modules)
  if (!validModule(request.mainModule) || entries.length === 0 || entries.length > projectPolicy.maxModules
    || !Object.hasOwn(request.modules, request.mainModule)) throw new Error("Invalid project module manifest")
  let size = 0
  const modules: Record<string, string> = Object.create(null)
  for (const [path, source] of entries) {
    if (!validModule(path) || typeof source !== "string") throw new Error("Invalid project module manifest")
    size += encoder.encode(source).byteLength
    if (size > projectPolicy.maxSourceBytes) throw new Error("Project source exceeds limit")
    modules[path] = source
  }
  if (request.checks.length === 0 || request.checks.length > projectPolicy.maxChecks) throw new Error("Invalid project assertions")
  const names = new Set<string>()
  const checks = request.checks.map((check) => {
    if (!/^[a-zA-Z0-9 -]{1,64}$/.test(check.name) || names.has(check.name)
      || !/^\/[a-zA-Z0-9/_-]*$/.test(check.path)
      || !Number.isInteger(check.status) || check.status < 200 || check.status > 599
      || typeof check.body !== "string" || encoder.encode(check.body).byteLength > projectPolicy.maxResponseBytes) throw new Error("Invalid project assertions")
    names.add(check.name)
    return { ...check }
  })
  return { mainModule: request.mainModule, modules, checks }
}
/** Limits allocation while reading a malicious stream; never trust Content-Length. */
export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error("Response exceeds limit")
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
