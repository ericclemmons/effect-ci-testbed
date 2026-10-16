import { readBoundedText } from "./project-protocol.ts"
import { projectTestPolicy as policy, validateProjectTests, type ProjectTestRequest, type ProjectTestResult } from "./test-protocol.ts"

// Internal host-prepared artifact. Never accept this bundle from project/event input.
export interface PreparedAssertions { readonly mainModule: string; readonly modules: Readonly<Record<string, string | { js?: string }>> }
/** Host callback only; never deserialized from project/request data or exposed in child env. */
export interface ProjectTestHostOptions { readonly tailForTest?: (index: number) => Fetcher[] }
export async function runPreparedProjectTests(loader: WorkerLoader, trusted: PreparedAssertions, input: ProjectTestRequest, host: ProjectTestHostOptions = {}): Promise<ProjectTestResult> {
  const request = validateProjectTests(input), tools: Record<string, string> = Object.create(null)
  const entries = Object.entries(trusted.modules)
  if (!entries.length || entries.length > policy.maxToolModules || !Object.hasOwn(trusted.modules, trusted.mainModule))
    throw Error("Invalid host assertion bundle")
  let toolBytes = 0
  for (const [path, module] of entries) {
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.js$/.test(path) || path.split("/").some(p => p === "." || p === "..") || path.startsWith("project/") || path === "__runner.js")
      throw Error("Invalid host assertion bundle")
    const js = typeof module === "string" ? module : module.js
    if (typeof js !== "string") throw Error("Invalid host assertion bundle")
    toolBytes += new TextEncoder().encode(js).byteLength
    if (toolBytes > policy.maxToolBytes) throw Error("Host assertion bundle exceeds limit")
    tools[path] = js
  }
  const toolDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
    JSON.stringify([trusted.mainModule, Object.entries(tools).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]),
  ))), b => b.toString(16).padStart(2, "0")).join("")
  const tests: ProjectTestResult["tests"][number][] = []
  for (const [index, test] of request.tests.entries()) {
    const modules: Record<string, string> = { ...tools }
    for (const [path, source] of Object.entries(request.modules)) modules["project/" + path] = source
    modules["__runner.js"] = `import{run}from${JSON.stringify("./" + trusted.mainModule)};
      import*as suite from${JSON.stringify("./project/" + request.mainModule)};
      export default{fetch(){return run(suite[${JSON.stringify(test.export)}])}};`
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Deliberately load a FRESH isolate for every test. Never loader.get/cache.
      const child = loader.load({ compatibilityDate: "2026-10-07", compatibilityFlags: [],
        mainModule: "__runner.js", modules, env: {}, globalOutbound: null,
        limits: { cpuMs: policy.cpuMs, subRequests: 0 },
        ...(host.tailForTest ? { tails: host.tailForTest(index) } : {}) }).getEntrypoint()
      const raw = await Promise.race([
        (async () => {
          const response = await child.fetch(new Request("https://test.invalid", { signal: abort.signal }))
          if (response.status !== 200) throw Error("Invalid test response")
          return readBoundedText(response, policy.maxResponseBytes)
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(Error("Test deadline exceeded")) }, policy.timeoutMs) }),
      ])
      const value = JSON.parse(raw)
      if (typeof value.passed !== "boolean" || !Number.isInteger(value.assertions) || value.assertions < 0 || value.assertions > policy.maxAssertions ||
          (value.passed && value.assertions === 0) || (!value.passed && value.failure !== "assertion" && value.failure !== "execution")) throw Error("Invalid test response")
      tests.push({ name: test.name, passed: value.passed, assertions: value.assertions,
        ...(value.passed ? {} : { failure: value.failure }) })
    } catch {
      // No project exception, assertion value, body, URL or stack leaves the child.
      tests.push({ name: test.name, passed: false, assertions: 0, failure: "execution" })
    } finally { if (timer !== undefined) clearTimeout(timer); abort.abort() }
  }
  return { runtime: "dynamic-worker", tool: "vitest-expect-5.0.3-subset", containers: 0,
    toolModuleCount: entries.length, toolBytes, toolDigest, tests }
}
