import { createWorker } from "@cloudflare/worker-bundler"
import { runPreparedStaticBuild, validateStaticBuildSource } from "./prepared-static-build.ts"
import { staticBuildToolSource } from "./static-build-source.ts"
import { runStaticBuildIsolation } from "./static-build-isolation.ts"
export { staticBuildPolicy } from "./prepared-static-build.ts"
export type { StaticBuildResult } from "./prepared-static-build.ts"

/** Trusted host API: no incoming compiler, plugin, target, binding or credentials. */
async function prepareCompiler() {
  return createWorker({ entryPoint: "trusted/compiler.js", files: {
    "package.json": JSON.stringify({ dependencies: { sucrase: "3.35.1", "ts-interface-checker": "0.1.13" } }),
    "trusted/compiler.js": staticBuildToolSource,
  }, minify: true,
    // worker-bundler's legacy package-main resolver does not add .js to
    // ts-interface-checker's "dist/index". Keep this fixed tool alias private;
    // never accept project aliases or grant Node compatibility to the child.
    virtualModules: { "ts-interface-checker": 'export * from "ts-interface-checker/dist/index.js";' },
  }).catch(() => { throw Error("Static compiler preparation failed") })
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
