import type { HealthDecision } from "../../../packages/cloudflare/src/health-gate.ts"
import type { ReleaseJournal } from "../../release-manager/src/release-manager.ts"

export function verifyHealthyLab(observations: ReadonlyArray<{ phase: number; decision: HealthDecision }>,
  restored: Pick<ReleaseJournal, "status" | "deployment">, baselineVersion: string): void {
  for (const phase of [10, 25, 75, 100]) {
    if (observations.filter((item) => item.phase === phase).at(-1)?.decision.status !== "advance") throw new Error("Healthy lab is missing a phase health gate")
  }
  if (restored.status !== "rolled-back" || restored.deployment.versions.length !== 1 ||
    restored.deployment.versions[0]?.version !== baselineVersion || restored.deployment.versions[0]?.percentage !== 100) throw new Error("Healthy lab cleanup allocation mismatch")
}

export function verifyLabRollback(scenario: "regression" | "exhaustion", reason: string,
  decisions: ReadonlyArray<HealthDecision>, restored: Pick<ReleaseJournal, "status" | "deployment">, baselineVersion: string): void {
  const expected = scenario === "regression" ? "Conclusive HMD SLO breach" : "HMD observation budget exhausted"
  if (!reason.includes(expected) || !decisions.length ||
    (scenario === "regression" && decisions.at(-1)?.status !== "regression") ||
    (scenario === "exhaustion" && (decisions.length !== 10 || decisions.some((item) => item.status !== "uncertain")))) {
    throw new Error("HMD lab failed unexpectedly; baseline rollback completed")
  }
  if (restored.status !== "rolled-back" || restored.deployment.versions.length !== 1 ||
    restored.deployment.versions[0]?.version !== baselineVersion || restored.deployment.versions[0]?.percentage !== 100) {
    throw new Error("HMD rollback allocation mismatch")
  }
}
