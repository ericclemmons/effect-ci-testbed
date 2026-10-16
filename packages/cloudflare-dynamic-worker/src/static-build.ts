import { createWorker } from "@cloudflare/worker-bundler"
import { runPreparedStaticBuild, validateStaticBuildSource } from "./prepared-static-build.ts"
import { staticBuildToolSource } from "./static-build-source.ts"
export { staticBuildPolicy } from "./prepared-static-build.ts"
export type { StaticBuildResult } from "./prepared-static-build.ts"

/** Trusted host API: no incoming compiler, plugin, target, binding or credentials. */
export async function buildStaticTypeScript(loader: WorkerLoader, input: unknown) {
  const source = validateStaticBuildSource(input)
  const trusted = await createWorker({ entryPoint: "trusted/compiler.js", files: {
    "package.json": JSON.stringify({ dependencies: { sucrase: "3.35.1" } }),
    "trusted/compiler.js": staticBuildToolSource,
  }, minify: true }).catch(() => { throw Error("Static compiler preparation failed") })
  return runPreparedStaticBuild(loader, trusted, source)
}
