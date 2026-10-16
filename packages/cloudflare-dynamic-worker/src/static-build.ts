import { createWorker } from "@cloudflare/worker-bundler"
import { runPreparedStaticBuild, validateStaticBuildSource } from "./prepared-static-build.ts"
import { staticBuildToolSource } from "./static-build-source.ts"
import { runStaticBuildIsolation } from "./static-build-isolation.ts"
export { staticBuildPolicy } from "./prepared-static-build.ts"
export type { StaticBuildResult } from "./prepared-static-build.ts"

/** Trusted host API: no incoming compiler, plugin, target, binding or credentials. */
async function prepareCompiler() {
  return createWorker({ entryPoint: "trusted/compiler.js", files: {
    "package.json": JSON.stringify({ dependencies: { sucrase: "3.35.1" } }),
    "trusted/compiler.js": staticBuildToolSource,
  }, minify: true }).catch(() => { throw Error("Static compiler preparation failed") })
}
export async function buildStaticTypeScript(loader: WorkerLoader, input: unknown) {
  const source = validateStaticBuildSource(input)
  return runPreparedStaticBuild(loader, await prepareCompiler(), source)
}
/** Host-only fixed tests; cannot publish assets or choose code/destinations. */
export async function verifyStaticBuildIsolation(loader: WorkerLoader,
  parentBundle: { readonly path: "/bundle/index.js"; readonly bytes: number; readonly sha256: string }) {
  return runStaticBuildIsolation(loader, await prepareCompiler(), parentBundle)
}
