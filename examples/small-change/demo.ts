import * as CI from "@effect-ci-testbed/ci"
import type { SmallChangeEvidence } from "../../packages/github/src/small-change.ts"
import { approveSmallChanges } from "./workflow.ts"

export const evidence = (path: string): SmallChangeEvidence => ({
  head: "a".repeat(40), base: "b".repeat(40), open: true, draft: false, complete: true,
  files: [{ path, additions: 2, deletions: 1 }],
  checks: [],
  review: { head: "a".repeat(40), base: "b".repeat(40), complete: false, kind: "documentation-policy", findings: [] },
  experience: {},
})

if (import.meta.main) {
  console.log("LOCAL POLICY REHEARSAL — fixture evidence; no GitHub review or merge is sent.")
  for (const path of ["README.md", "src/app.ts", "package.json"]) {
    const writes: string[] = []
    const result = await CI.runPromise(approveSmallChanges({
      read: async () => evidence(path),
      approve: async (_evidence, decision) => { writes.push(`Would APPROVE commit ${decision.head}`) },
    }), { output: "silent" })
    console.log(JSON.stringify({ path, eligible: result.value?.eligible,
      actions: result.plan.nodes.map(node => node.id), writes, reasons: result.value?.reasons }))
  }
}
