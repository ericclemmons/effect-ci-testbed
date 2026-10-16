export interface ProjectTestRequest {
  readonly mainModule: string
  readonly modules: Readonly<Record<string, string>>
  readonly tests: ReadonlyArray<{ readonly name: string; readonly export: string }>
}
export interface ProjectTestResult {
  readonly runtime: "dynamic-worker"
  readonly tool: "vitest-expect-5.0.3-subset"
  readonly containers: 0
  readonly toolModuleCount: number
  readonly toolBytes: number
  readonly tests: ReadonlyArray<{ readonly name: string; readonly passed: boolean; readonly assertions: number; readonly failure?: "assertion" | "execution" }>
}
export const projectTestPolicy = Object.freeze({ maxModules: 16, maxSourceBytes: 65536,
  maxTests: 16, maxAssertions: 64, maxToolModules: 16, maxToolBytes: 524288,
  cpuMs: 1000, timeoutMs: 5000, maxResponseBytes: 1024 })
const fields = (input: unknown, keys: string[]) => {
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== keys.length) throw Error("Invalid project tests")
  const result: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(input, key)
    if (!d || !("value" in d)) throw Error("Invalid project tests")
    result[key] = d.value
  }
  return result
}
const validPath = (path: unknown): path is string => typeof path === "string" && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.js$/.test(path)
export function validateProjectTests(input: unknown): ProjectTestRequest {
  const r = fields(input, ["mainModule", "modules", "tests"])
  if (!validPath(r.mainModule) || !r.modules || typeof r.modules !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(r.modules))) throw Error("Invalid project tests")
  const paths = Reflect.ownKeys(r.modules), modules: Record<string, string> = Object.create(null)
  if (!paths.length || paths.length > projectTestPolicy.maxModules) throw Error("Invalid project tests")
  let bytes = 0
  for (const path of paths) {
    if (!validPath(path)) throw Error("Invalid project tests")
    const descriptor = Object.getOwnPropertyDescriptor(r.modules, path)
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") throw Error("Invalid project tests")
    bytes += new TextEncoder().encode(descriptor.value).byteLength
    if (bytes > projectTestPolicy.maxSourceBytes) throw Error("Project test source exceeds limit")
    modules[path] = descriptor.value
  }
  if (!Object.hasOwn(modules, r.mainModule) || !Array.isArray(r.tests) || !r.tests.length ||
      r.tests.length > projectTestPolicy.maxTests) throw Error("Invalid project tests")
  const names = new Set<string>(), tests: { name: string; export: string }[] = []
  for (let i = 0; i < r.tests.length; i++) {
    const d = Object.getOwnPropertyDescriptor(r.tests, String(i))
    if (!d || !("value" in d)) throw Error("Invalid project tests")
    const t = fields(d.value, ["name", "export"])
    if (typeof t.name !== "string" || !/^[A-Za-z0-9 -]{1,64}$/.test(t.name) || names.has(t.name) ||
        typeof t.export !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(t.export)) throw Error("Invalid project tests")
    names.add(t.name); tests.push({ name: t.name, export: t.export })
  }
  return { mainModule: r.mainModule, modules, tests }
}
