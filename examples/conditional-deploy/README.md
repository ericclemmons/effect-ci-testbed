# Deploy only when needed

Skip work when its inputs did not change. Use ordinary control flow:

## Start with a source query

[Source](./.cloudflare/ci/if-else.ts#symbol=default "source")

Paths are repository-relative. Include shared dependencies and configuration.
Globs support `*`, `**`, `?`, and alternatives such as `**/*.(ts|tsx|json)`.
Added, deleted, and renamed paths count. Unknown comparisons return `true`.

```sh
pnpm exec cf-ci run --workflow examples/conditional-deploy/.cloudflare/ci/if-else.ts
```

This deployment prints a message. Local comparisons use the remote default
branch; event adapters supply the comparison in CI.

## Compare built output

A source change need not change what ships. Build first, then compare the result:

[Source](./.cloudflare/ci/output-changes.ts#symbol=default "source")

```sh
pnpm ci:changed-outputs
pnpm ci:changed-outputs
```

The first run publishes a local directory; the second skips it. Edit
[the shared module](./outputs/shared/message.mjs) and repeat: changed output
publishes again. Failed publication keeps the previous successful baseline.

For event/ref conditions that must appear in a plan, use
[CI.when](./.cloudflare/ci/workflow.ts). Ordinary JavaScript branches do not
serialize both paths during planning.

## Route a whole action subgraph

Use `CI.branch` when both alternatives need to be inspectable before commands
run. A push selects the release lane; other events select preview. This example
only prints messages. It does not deploy anything.

[Two-branch workflow](./.cloudflare/ci/subgraph.ts "source")

[Action ownership, dependencies and cleanup](./.cloudflare/ci/subgraph-actions.ts "source")

Each alternative lists its complete ordered membership, with prerequisites before
their consumers. Shared prerequisites run before the branch. The
runtime rejects an undeclared prerequisite rather than discovering ownership by
executing an unselected body. IDs are supplied by the author, remain unchanged
across outcomes, and cannot be shared between alternatives. Branches belong in
the workflow, not inside actions. Use an empty array for a no-op alternative.
Rollback actions also need exclusive IDs so their condition and `rollbackFor`
owner stay unambiguous.

`plan.branches` records the branch ID, predicate, ordered `onTrue`/`onFalse` IDs
and selected alternative for the supplied event. Every member and rollback has
its predicate in `plan.nodes`. Planning uses the existing action interpreter to
record both lanes' commands without executing those commands. Action construction
and ordinary Effect code still run during planning; this is not a sandbox for
arbitrary side effects or an attempt to serialize JavaScript control flow.

Execution runs the selected list in order, records the other list as skipped
without invoking its constructors or command bodies, and joins only the selected
tail. Existing action IDs, memoization, required dependencies, optional ordering,
and rollback remain owned by the action runtime. This is not a parallel scheduler.
Do not nest `CI.when` inside a member; put the event/ref predicate on the branch.

```sh
EFFECT_CI_EVENT=push pnpm exec cf-ci --workflow examples/conditional-deploy/.cloudflare/ci/subgraph.ts plan --format=json
EFFECT_CI_EVENT=push pnpm exec cf-ci run --workflow examples/conditional-deploy/.cloudflare/ci/subgraph.ts --format=json
EFFECT_CI_EVENT=pull_request pnpm exec cf-ci run --workflow examples/conditional-deploy/.cloudflare/ci/subgraph.ts --format=json
```

The selected advisory command deliberately fails and becomes a warning; publish,
verify and the report still run. Set `GITHUB_REF=refs/heads/required-failure` on
either execution command to fail publish instead: verify/report do not run, then
cleanup runs for the failed publish and the completed prepare, in that order.
The process exits with code 1. Each command can emit the existing runtime event
stream with `EFFECT_CI_EVENT_FD=3` and shell redirection `3>events.jsonl`, including
the final failed plan and cleanup command output that the CLI error alone omits.

[Conventional shell comparison](./conventional.sh "source")

Run `sh examples/conditional-deploy/conventional.sh push` (or `pull_request`).
Its second argument can be `refs/heads/required-failure` for the same deliberate
failure and reverse cleanup. The shell comparison prints the same operations;
it does not provide a serialized plan or durable recovery.

[Verification scope and receipts](./subgraph-verification.md)
