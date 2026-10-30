// Container-only entrypoint. Project modules execute here, never in the host
// Worker. This installs no approval, signing, deployment or host-env capability.
import { readFileSync } from "node:fs"
import { registerHooks, stripTypeScriptTypes } from "node:module"
import { fileURLToPath } from "node:url"

const runtime = new URL("../", import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Use one SDK/Effect instance even when the checked-out project hasn't
    // installed the unpublished SDK (or has a different version installed).
    if (specifier === "@effect-ci-testbed/ci" || specifier.startsWith("@effect-ci-testbed/ci/") ||
        specifier === "effect" || specifier.startsWith("effect/")) {
      return nextResolve(specifier, { ...context, parentURL: import.meta.url })
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    // pnpm deploy materializes our private workspace packages under node_modules.
    // Node's default TS loader refuses that location. Only the pinned runtime's
    // own package sources use this hook; ordinary project loading is unchanged.
    if (url.startsWith(runtime) && url.endsWith(".ts")) {
      return { format: "module", shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "strip", sourceUrl: url }) }
    }
    return nextLoad(url, context)
  },
})

await import("./effect-ci.ts")
