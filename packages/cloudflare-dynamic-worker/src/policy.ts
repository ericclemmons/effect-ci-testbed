import type * as CI from "@effect-ci-testbed/ci"

const baseIsolateCapabilities = new Set<CI.ExecutionCapability>([
  "javascript",
  "wasm",
])

export interface ExecutionTierOptions {
  readonly allowNetwork?: boolean
}

export interface ExecutionTierDecision {
  readonly reason: string
  readonly tier: "container" | "dynamic-worker"
}

/** Conservative by design: undeclared work and explicit container preference stay in a container. */
export const selectExecutionTier = (
  requirements: CI.ExecutionRequirements | undefined,
  options: ExecutionTierOptions = {},
): ExecutionTierDecision => {
  if (!requirements) {
    return { tier: "container", reason: "execution capabilities were not declared" }
  }
  if (requirements.preference === "container") {
    return { tier: "container", reason: "the action explicitly requested a container" }
  }

  const supported = new Set(baseIsolateCapabilities)
  if (options.allowNetwork) supported.add("network")
  const missing = requirements.capabilities.filter((capability) => !supported.has(capability))

  return missing.length === 0
    ? { tier: "dynamic-worker", reason: "all declared capabilities are isolate-safe" }
    : {
        tier: "container",
        reason: `Dynamic Workers do not provide: ${missing.join(", ")}`,
      }
}
