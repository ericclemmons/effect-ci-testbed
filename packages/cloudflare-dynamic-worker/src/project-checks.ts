/** Host-owned assertions over untrusted Worker-compatible ESM. Never import these modules in the host. */
import * as Effect from "effect/Effect"
import { projectPolicy, validateProject, readBoundedText } from "./project-protocol.ts"
import type { ProjectRequest, ProjectChecksService } from "./project-service.ts"
export { ProjectChecks } from "./project-service.ts"
export type { ProjectCheck, ProjectRequest, ProjectResult, ProjectChecksService } from "./project-service.ts"
export { projectPolicy, validateProject, readBoundedText } from "./project-protocol.ts"
export const makeProjectChecks = (loader: WorkerLoader): ProjectChecksService => ({
  run: (request) => Effect.tryPromise(() => runProjectChecks(loader, request)),
})
export async function runProjectChecks(loader: WorkerLoader, input: ProjectRequest) {
  const request = validateProject(input)
  const passed: string[] = []
  for (const check of request.checks) {
    // Fresh child per assertion: globals and a previous request cannot influence another check.
    // Explicit null matters: omission inherits the parent's network authority.
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    try {
      const child = loader.load({
        compatibilityDate: projectPolicy.compatibilityDate, compatibilityFlags: [],
        mainModule: request.mainModule, modules: request.modules, env: {}, globalOutbound: null,
        limits: { cpuMs: projectPolicy.cpuMs, subRequests: projectPolicy.subRequests },
      }).getEntrypoint()
      await Promise.race([
        (async () => {
          const response = await child.fetch(new Request(`https://project.invalid${check.path}`, { signal: abort.signal }))
          const body = await readBoundedText(response, projectPolicy.maxResponseBytes)
          if (response.status !== check.status || body !== check.body) throw new Error("Assertion mismatch")
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error("Deadline exceeded")) }, projectPolicy.timeoutMs) }),
      ])
      passed.push(check.name)
    } catch {
      // Untrusted exception/body/header text is not host diagnostics or a verification receipt.
      throw new Error(`Project check failed: ${check.name}`)
    } finally { if (timer !== undefined) clearTimeout(timer); abort.abort() }
  }
  return { runtime: "dynamic-worker" as const, passed, containers: 0 as const }
}
