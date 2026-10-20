import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { pathGlob } from "@effect-ci-testbed/ci/paths"
import { smallChange, type SmallChangeEvidence, type SmallChangeDecision } from "../../packages/github/src/small-change.ts"
import { approveSmallChanges } from "./workflow.ts"

export const evidence = (path: string): SmallChangeEvidence => ({
  head: "a".repeat(40), base: "b".repeat(40), open: true, draft: false, complete: true,
  files: [{ path, additions: 2, deletions: 1 }],
  checks: [],
  review: { head: "a".repeat(40), base: "b".repeat(40), complete: false, kind: "documentation-policy", findings: [] },
  experience: {},
})

// Local demo wiring. A deployed App supplies a canonical reader and journaled writer.
export function smallChangeExample(host: {
  read: () => Promise<SmallChangeEvidence>
  approve: (evidence: SmallChangeEvidence, decision: SmallChangeDecision) => Promise<void>
}) {
  let observed: Promise<SmallChangeEvidence> | undefined
  const read = () => observed ??= host.read()
  const code = pathGlob("**/*.(ts|tsx|json)")
  const policy = (input: SmallChangeEvidence) => !input.files.some(file => code.test(file.path))
  const source: CI.SourceService = {
    checkout: () => Effect.die("This example reads the PR diff through the App"),
    changes: () => Effect.tryPromise(async (): Promise<CI.SourceChanges> => {
      const input = await read()
      return smallChange(input, () => true).eligible
        ? { status: "known", base: input.base, head: input.head, paths: input.files.map(file => file.path) }
        : { status: "unknown", reason: "unavailable" }
    }),
  }
  const approve = CI.action<SmallChangeDecision | undefined>("approve small change", () => function* () {
    if ((yield* CI.executionMode) === "plan") return
    const input = yield* Effect.tryPromise(read)
    const decision = smallChange(input, policy)
    if (!decision.eligible) return
    const current = yield* Effect.tryPromise(() => host.read())
    if (JSON.stringify(current) !== JSON.stringify(input)) throw Error("PR evidence changed; normal review required")
    yield* Effect.tryPromise(() => host.approve(input, decision))
    return decision
  }, { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" })
  return { workflow: approveSmallChanges(approve), source }
}

if (import.meta.main) {
  console.log("Safe-change policy: no TypeScript, TSX or JSON changes. Local demo; no GitHub writes.")
  for (const path of ["README.md", "docs/guide.md", "src/app.ts", "src/Button.tsx", "package.json"]) {
    const writes: string[] = []
    const example = smallChangeExample({
      read: async () => evidence(path),
      approve: async (_evidence, decision) => { writes.push(`Would APPROVE commit ${decision.head}`) },
    })
    const result = await CI.runPromise(example.workflow, { output: "silent", source: example.source })
    console.log(JSON.stringify({ path, approved: result.value?.eligible === true,
      actions: result.plan.nodes.map(node => node.id), writes }))
  }
}
