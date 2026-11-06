import { checkNames, environments } from "./compatibility.mjs"
import { cellResult } from "./readiness.mjs"

// Product features, each backed by recipe checks in the readiness snapshot.
// `walkthrough` is a fragment of examples/demo/README.md; null marks a gap.
export const features = [
  { title: "Zero-config", claim: "Runs existing package scripts with no workflow file.", walkthrough: "4-run-the-build", recipes: ["zero-config"] },
  { title: "Caching by default", claim: "Adapters restore task and download caches without workflow code.", walkthrough: "5-cache-the-build", recipes: ["vite-plus-cache", "turborepo-cache", "package-manager-cache"] },
  { title: "Signed checks", claim: "A trusted host skips a check that already passed for the same commit.", walkthrough: null, recipes: ["verification-evidence"] },
  { title: "Fast checks", claim: "Faster than the equivalent GitHub Actions workflow.", walkthrough: null, recipes: [] },
  { title: "Parallel checks", claim: "CI.parallel runs independent goals at once; shared prerequisites run once.", walkthrough: "13-lint-while-you-build", recipes: ["snapshot-fanout", "test-splitting", "matrix"] },
  { title: "Agent-friendly", claim: "Every command has a JSON form for agents.", walkthrough: "3-inspect-before-running", recipes: [], checks: ["agent-first executable CI"] },
  { title: "Incrementally adoptable", claim: "Start with package scripts; add ci.ts only where you need control.", walkthrough: "9-own-the-workflow", recipes: ["demo", "exported-actions"] },
  { title: "Event-driven", claim: "A workflow reacts to its event and ref, such as deploying only from main.", walkthrough: "14-publish-only-from-main", recipes: ["conditional-deploy", "ordered-deploy", "deploy-hook"] },
  { title: "Dependency injection", claim: "Hosts provide checkout, approval and storage; workflows only ask for them.", walkthrough: "how-a-run-works", recipes: ["source-providers", "r2-source", "gitlab-source"] },
  { title: "Configurable", claim: "Cache, retry, timeout and runner policy live in code.", walkthrough: "replace-shell-plumbing-with-sdk-methods", recipes: ["cache-policy", "execution-policy", "runner-selection"] },
  { title: "Extensible", claim: "Share actions as modules and plug in your own adapters.", walkthrough: null, recipes: ["exported-actions", "workspace"] },
  { title: "Change-aware", claim: "Skips work when the changed files or built output do not need it.", walkthrough: "skip-markdown-only-changes", recipes: ["deploy-changed-output", "small-change"] },
  { title: "Local and remote parity", claim: "The same program runs locally, on GitHub Actions and on Cloudflare.", walkthrough: "7-enroll-oidc-and-run-on-a-host", recipes: ["cloudflare-runner", "runner-selection"] },
  { title: "Short-lived credentials", claim: "OIDC tokens are issued per job and revoked when it ends.", walkthrough: "11-deploy-with-temporary-credentials", recipes: ["oidc-cf", "oidc-wrangler", "secure-secrets"] },
  { title: "Approval gates", claim: "Publication waits for a person to approve.", walkthrough: "require-approval-before-publication", recipes: ["hitl-deploy", "cloudflare-hitl-release"] },
]

const failing = ["failure", "timed_out", "action_required", "startup_failure"]

/** Every conclusive and inconclusive result for a feature's recipes in one snapshot. */
export function featureEvidence(feature, snapshot, rows) {
  const recipeCells = feature.recipes.flatMap(recipe => {
    const row = rows.find(row => row.recipe === recipe)
    const cells = row?.cells ?? environments.map(() => true)
    return environments.flatMap((environment, index) => environment === "cf ci" || !cells[index] ? [] :
      [cellResult(snapshot, checkNames(recipe, environment), index === 3 ? "effect-ci" : "github-actions")])
  })
  const namedCells = (feature.checks ?? []).map(name => {
    const check = snapshot.check_runs.find(check => check.name === name)
    return {
      passing: check?.conclusion === "success",
      failing: failing.includes(check?.conclusion),
      state: check ? `${name}: ${check.conclusion ?? "unverified"}` : "missing check",
    }
  })
  return [...recipeCells, ...namedCells]
}

/** Red until passing evidence exists; any failure turns a feature red again. */
export function featureStatus(evidence) {
  const passed = evidence.filter(cell => cell.passing).length
  const failed = evidence.filter(cell => cell.failing).length
  if (!evidence.length) return { color: "red", label: "No proof yet", passed, failed, total: 0 }
  if (failed) return { color: "red", label: `${failed} failing`, passed, failed, total: evidence.length }
  if (passed) return { color: "green", label: `${passed} / ${evidence.length} passing`, passed, failed, total: evidence.length }
  return { color: "gray", label: "No result in snapshot", passed, failed, total: evidence.length }
}
