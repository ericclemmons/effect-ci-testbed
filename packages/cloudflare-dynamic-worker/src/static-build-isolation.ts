import { runPreparedStaticBuild, staticBuildPolicy, type PreparedStaticCompiler } from "./prepared-static-build.ts"

/** Closed owned capability checks. No incoming project, destination, tool or credential. */
export async function runStaticBuildIsolation(loader: WorkerLoader, compiler: PreparedStaticCompiler,
  parentBundle: { readonly path: "/bundle/index.js"; readonly bytes: number; readonly sha256: string }) {
  if (parentBundle.path !== "/bundle/index.js" || !Number.isSafeInteger(parentBundle.bytes) || parentBundle.bytes < 1 ||
      parentBundle.bytes > 24 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(parentBundle.sha256)) throw Error("Invalid parent bundle canary")
  const built = await runPreparedStaticBuild(loader, compiler, 'const marker: string = "owned build isolation";')
  if (built.code.includes(": string") || !built.code.includes("owned build isolation")) throw Error("Compiler verification failed")
  for (const [source, expected] of [["const = ;", "Static build failed; no output authorized for publication"],
    ["x".repeat(32769), "Invalid static build source"]]) {
    let rejected = false
    try { await runPreparedStaticBuild(loader, compiler, source) }
    catch (error) { rejected = error instanceof Error && error.message === expected }
    if (!rejected) throw Error("Compiler resource/source verification failed")
  }
  const probes = {
    bindings: `export default{fetch(r,env){return Response.json({code:JSON.stringify(Object.keys(env))})}}`,
    network: `export default{async fetch(){let code='allowed';try{await fetch('https://effect-ci-denied.invalid/')}catch{code='denied'}return Response.json({code})}}`,
    parentBundle: `export default{async fetch(){let code='allowed';try{(await import('node:fs')).readFileSync('/bundle/index.js')}catch{code='denied'}return Response.json({code})}}`,
    nativeProcess: `export default{async fetch(){let code='allowed';try{(await import('node:child_process')).execSync('true')}catch{code='denied'}return Response.json({code})}}`,
    freshState: `let calls=0;export default{fetch(){return Response.json({code:String(++calls)})}}`,
  }
  for (const [name, source] of Object.entries(probes)) {
    const expected = name === "bindings" ? "[]" : name === "freshState" ? "1" : "denied"
    for (let i = 0; i < (name === "freshState" ? 2 : 1); i++) {
      const result = await runPreparedStaticBuild(loader, { mainModule: "capability.js", modules: { "capability.js": source } }, "")
      if (result.code !== expected) throw Error("Build isolate capability verification failed")
    }
  }
  return { runtime: "dynamic-worker" as const, tool: staticBuildPolicy.tool, toolDigest: built.toolDigest, containers: 0,
    sourceDigest: built.sourceDigest, outputDigest: built.outputDigest, parentBundle: { ...parentBundle },
    checks: { typeScriptErased: true, malformedSourceRejected: true, oversizeSourceRejected: true,
      emptyChildBindings: true, networkDenied: true, parentBundleFileDenied: true, nativeProcessDenied: true, freshState: true },
    configuredLimits: { cpuMs: staticBuildPolicy.cpuMs, subRequests: 0, hostTimeoutMs: staticBuildPolicy.timeoutMs },
    cpuEnforcementMeasured: false, externalWrites: 0 }
}
