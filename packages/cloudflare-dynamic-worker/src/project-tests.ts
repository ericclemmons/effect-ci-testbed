import { createWorker } from "@cloudflare/worker-bundler"
import * as Effect from "effect/Effect"
import { runPreparedProjectTests } from "./prepared-tests.ts"
import { validateProjectTests, type ProjectTestRequest } from "./test-protocol.ts"
import { assertionRuntimeSource } from "./assertion-source.ts"
export { projectTestPolicy, validateProjectTests } from "./test-protocol.ts"
export type { ProjectTestRequest, ProjectTestResult } from "./test-protocol.ts"

// Host-owned pinned tooling ONLY is bundled. Project modules are appended later
// as raw child modules, never passed to the host bundler/resolver or evaluated here.
export const makeProjectTests = (loader: WorkerLoader) => ({
  run: (input: ProjectTestRequest) => Effect.tryPromise(async () => {
    const request = validateProjectTests(input)
    const trusted = await createWorker({ entryPoint: "trusted/assertions.js", files: {
      "package.json": JSON.stringify({ dependencies: { "@vitest/expect": "5.0.3" } }),
      "trusted/assertions.js": assertionRuntimeSource,
    }, minify: true })
    return runPreparedProjectTests(loader, trusted, request)
  }),
})
