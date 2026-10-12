import * as CI from "@effect-ci-testbed/ci"
import * as Dynamic from "@effect-ci-testbed/cloudflare-dynamic-worker/project"
import * as Effect from "effect/Effect"

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})
const check = CI.action<Awaited<ReturnType<typeof Dynamic.runProjectChecks>>>("isolated project behavior", () => function* () {
  const workspace = yield* checkout()
  const mode = yield* CI.executionMode
  // Planning declares the dependency but must not execute untrusted code.
  if (mode === "plan") return { runtime: "dynamic-worker" as const, passed: [], containers: 0 as const }
  const modules: Record<string, string> = {}
  for (const name of ["index.js", "lib.js"]) {
    const source = yield* workspace.readFile(`app/${name}`)
    if (source === undefined) return yield* Effect.fail(new Error("Missing project module"))
    modules[name] = source
  }
  const service = yield* Dynamic.ProjectChecks
  return yield* service.run({ mainModule: "index.js", modules, checks: [
    { name: "module behavior", path: "/greeting", status: 200, body: "hello world" },
    { name: "bindings withheld", path: "/bindings", status: 200, body: "[]" },
    { name: "outbound denied", path: "/network", status: 200, body: "blocked" },
    { name: "unknown route", path: "/missing", status: 404, body: "not found" },
  ] })
})
export default CI.workflow("dynamic-project-checks", function* () { return yield* check() })
