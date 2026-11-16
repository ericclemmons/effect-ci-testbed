# Deploy only when needed

Skip work when its inputs did not change. Use ordinary control flow.

The snippets on this page come from this example's files, which CI runs end to
end.

## Start with a source query

Create `.cloudflare/ci/actions.ts` with the deploy action. It checks out the
source and runs the deploy command:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source")

Create a workflow that asks `CI.Source` whether the deployment's inputs changed,
then deploys only in that branch:

[`.cloudflare/ci/if-else.ts`](./.cloudflare/ci/if-else.ts "source {7-11}")

Paths are repository-relative. Include shared dependencies and configuration.
Effect globs include dotfiles and support `*`, `**`, `?`, character classes, and brace alternatives such as `**/*.{ts,tsx,json}`.
Added, deleted, and renamed paths count. Unknown comparisons return `true`.

```sh
cd examples/conditional-deploy
effect-ci run .cloudflare/ci/if-else.ts
```

This deployment prints a message. Local comparisons use the remote default
branch; event adapters supply the comparison in CI.

## Compare built output

A source change need not change what ships. Build first, then compare the result.

Start with the host configuration: one local destination and its complete
deployable scope. A remote host supplies its own provider:

[`.cloudflare/ci/output-changes.ts`](./.cloudflare/ci/output-changes.ts#L1-L10 "source")

Build, then publish the built workspace to that destination:

[`.cloudflare/ci/output-changes.ts`](./.cloudflare/ci/output-changes.ts#L12-L23 "source")

Pass the destination's change comparison to the local run, then deploy only when
`dist/**` changed:

[`.cloudflare/ci/output-changes.ts`](./.cloudflare/ci/output-changes.ts#symbol=local "source")

[`.cloudflare/ci/output-changes.ts`](./.cloudflare/ci/output-changes.ts#symbol=default "source {3}")

```sh
effect-ci run .cloudflare/ci/output-changes.ts
effect-ci run .cloudflare/ci/output-changes.ts
```

The first run publishes a local directory; the second skips it. Edit
[the shared module](./outputs/shared/message.mjs) and repeat: changed output
publishes again. Failed publication keeps the previous successful baseline.

## Condition on the event and ref

For event/ref conditions that must appear in a plan, use `CI.when`. Ordinary
JavaScript branches do not serialize both paths during planning:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#L5-L12 "source")
