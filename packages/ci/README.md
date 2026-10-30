# Effect CI SDK

> How do actions keep workflows small?

Actions own prerequisites. Workflows select goals and coordinate events, parallel
work, decisions and recovery.

[CI.action](./ACTION.md) · [CI.Approval](./APPROVAL.md) ·
[CI.Artifact](./ARTIFACT.md) · [CI.check](./CHECK.md) ·
[CI.PackageManager](./PACKAGE-MANAGER.md) · [CI.Secret](./SECRET.md) ·
[CI.Source](./SOURCE.md) · [CI.Toolchain](./TOOLCHAIN.md) ·
[CI.workflow](./WORKFLOW.md) · [CI.Workspace](./WORKSPACE.md)

```ts
import * as CI from "@effect-ci-testbed/ci"
import * as actions from "./actions.ts"

export { test, build } from "./actions.ts"

export default CI.workflow("project", function* () {
  return yield* CI.parallel([actions.test(), actions.build()])
})
```

```sh
effect-ci list
effect-ci plan test build --format=mermaid
effect-ci run test build
```

Shared prerequisites run once. Parallelism is explicit; the runtime does not
automatically schedule every ready node. Named exports are CLI targets. Export
goals deliberately; checkout and install usually stay private.

## Put dependencies in the action

An action has two phases:

1. Its generator resolves prerequisites and capabilities.
2. Its returned function does the work after those prerequisites succeed.

```ts
export const build = CI.action("build", function* () {
  const workspace = yield* test()
  const pm = yield* CI.PackageManager.JavaScript(workspace)
  return () => pm.run("build")
})
```

This assumes `test` returns a workspace. A pure `CI.check` returns `void`; get its
workspace from the shared install action instead. See the complete
[pnpm actions](../../examples/node-pnpm/.cloudflare/ci/actions.ts).

Putting lint before test only in the default workflow is not enough: a caller can
request `effect-ci run test` directly. The test action must own its required validation.

## Keep the runner out of the program

JavaScript package-manager installs freeze the lockfile by default, including
local runs. Pass `{ frozenLockfile: false }` only to request a mutable install.
The experimental [distributed Turbo recipe](../../examples/turbo-distributed)
adds `Toolchain.Turbo(workspace).tags(...)` alongside the existing Node and Mise
toolchains. It expands a native graph during execution, not ordinary planning.

- `CI.Source` supplies checkout. It may come from Git, a local directory, R2,
  Artifacts or a stored revision; actions do not choose provider credentials.
- An action returns a `CI.Workspace` by default. Use `CI.action<void>` for an
  intentional non-workspace result, or `CI.check` for a pure assertion.
- Workspace revisions carry dependency lineage. A checkpoint restores one exact
  revision; a cache restores only its owned paths into the current revision.
- Retry and timeout policy belongs to the action. The runner applies it locally
  or lowers it to native Workflow steps.
- `CI.Secret` stays redacted and host-owned. `CI.Artifact` transfers a checked
  output when it must cross to another workload.

GitHub YAML supplies its runner and cache. A Cloudflare host supplies native
Workflows, containers and storage. Neither belongs in portable `actions.ts`.

## Checks, conditions and recovery

`CI.check` may opt into trusted reuse. Missing or invalid evidence means execute;
an ordinary cache hit is not a signed attestation. Builds and deployments do not
become reusable checks just because their prerequisites were verified.

Optional check/result cache outages execute the work normally, including when an
adapter throws. A failed cache write does not fail successful work. Cancellation
still stops the run; required event/attempt persistence is not an optional cache.

`CI.when` records inspectable conditions. Ordinary `if/else` works too:

```ts
const source = yield* CI.Source
if (yield* source.changed(["apps/site/**", "packages/ui/**"])) {
  yield* deploy()
} else {
  // No matching changes.
}
```

`source.changes()` exposes the comparison and changed paths. The event adapter
normally supplies the base; local runs use the remote default branch. Unknown
comparisons run work. An explicit `{ base, head }` override remains available.
Globs support literal alternatives: `**/*.(ts|tsx|json)` matches those extensions
at the root or in nested directories. Unknown comparisons return `true`, so a
negated `source.changed(...)` guard never approves an unknown diff.
See [changed-file conditions](../../examples/conditional-deploy#start-with-a-source-query)
for glob support, deployment baselines and the planning boundary. This does not
infer dependencies or authorize attestation reuse. Action-owned rollback runs in
reverse completion order after terminal failure.

After building, compare the actual deployable with the destination's last
successful deployment:

```ts
const workspace = yield* build()
if (yield* workspace.changed("dist/**")) {
  yield* deploy()
}
```

Hosts supply `RunOptions.workspaceChanges`; absent or unavailable providers run
the work. This is a deployment decision, not a reusable execution receipt. The
[directory adapter](./src/directory-deployment.md) supplies a working local
destination with persisted byte comparison and atomic publication. See the
[executable example](../../examples/conditional-deploy#compare-built-output).
Cloudflare hosts can use [snapshot-backed deployment baselines](../cloudflare/src/snapshot-deployment.md)
with independent current-target byte verification.

Event adapters supply `CI.WorkflowEvent` and, when relevant, `CI.Source`. An error
event need not pretend to be a Git push. Hosted execution still requires an enrolled
program; the remote CLI does not upload arbitrary local TypeScript.

## Writing an executor

Return stdout, stderr and the process exit code. The core rejects a nonzero result
before recording reusable evidence or running dependents. Native adapters must
also throw *inside* their checkpoint: a failed command must never be persisted as
a successful native step. Optional actions may recover a command failure; required
actions may not.

[Examples](../../examples/README.md) · [Execution model source](./src/index.ts)
