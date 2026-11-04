# CI.Source

Use `yield* CI.Source` to read the source selected by the host. Actions use one
contract whether the files come from Git, a local directory, or object storage.
The host owns the provider, credentials, and revision.

## changed

`source.changed(patterns, comparison?)` answers whether matching paths changed.
Unknown comparisons return `true`, so missing evidence runs the work. Patterns
are relative to the repository. The host's event normally chooses the comparison;
an explicit `{ base, head?, mergeBase? }` can override it.

[Skip unchanged inputs](../../examples/conditional-deploy/.cloudflare/ci/if-else.ts#symbol=default "source")

[Changed-file solution](../../examples/conditional-deploy)

## changes

`source.changes(comparison?)` returns either known paths and comparison revisions,
or an unknown result with a reason. Use it when diagnostics or a custom decision
need more than a boolean. Planning returns an unknown comparison.

[Inspect the comparison](../../examples/workspace/.cloudflare/ci/actions.ts#symbol=compare "source")

[Result contract](./src/source-changes.ts#symbol=SourceChanges "source")

## checkout

`source.checkout()` returns a workspace for the selected source. With the default
local provider this is the current directory. A hosted provider may restore an
immutable revision; checkout does not choose a runner or install tools.

[Checkout into a project directory](../../examples/workspace/.cloudflare/ci/actions.ts#symbol=checkout "source")

[Artifacts](../../examples/artifacts-source) ·
[Durable Objects](../../examples/durable-object-source) ·
[GitHub / local Git](../../examples/source-providers) ·
[GitLab](../../examples/gitlab-source) · [R2](../../examples/r2-source)
