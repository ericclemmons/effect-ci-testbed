# Deploy only when needed

Skip work when its inputs did not change. Use ordinary control flow:

## Start with a source query

[Source](./.cloudflare/ci/if-else.ts#symbol=default "source")

Paths are repository-relative. Include shared dependencies and configuration.
Globs support `*`, `**`, `?`, and alternatives such as `**/*.(ts|tsx|json)`.
Added, deleted, and renamed paths count. Unknown comparisons return `true`.

```sh
cd examples/conditional-deploy
effect-ci run .cloudflare/ci/if-else.ts
```

This deployment prints a message. Local comparisons use the remote default
branch; event adapters supply the comparison in CI.

## Compare built output

A source change need not change what ships. Build first, then compare the result:

[Source](./.cloudflare/ci/output-changes.ts#symbol=default "source")

```sh
effect-ci run .cloudflare/ci/output-changes.ts
effect-ci run .cloudflare/ci/output-changes.ts
```

The first run publishes a local directory; the second skips it. Edit
[the shared module](./outputs/shared/message.mjs) and repeat: changed output
publishes again. Failed publication keeps the previous successful baseline.

For event/ref conditions that must appear in a plan, use
[CI.when](./.cloudflare/ci/workflow.ts). Ordinary JavaScript branches do not
serialize both paths during planning.
