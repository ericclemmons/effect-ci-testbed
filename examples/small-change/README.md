# Let authors self-merge safe changes

Not every PR needs the same approval policy. Let the GitHub App approve changes
your team considers safe, so authors and agents can self-merge once all checks pass.

Here we arbitrarily define “safe” as **no code changes**: no `.ts`, `.tsx`, or
`.json` files changed. Choose a different rule if that better fits your project.

The trusted workflow chooses the policy—not the PR being reviewed. Other GitHub
merge requirements still apply. This grants approval; it does not merge the PR.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the policy

Create `workflow.ts`. `source.changed` supplies the change predicate: the
workflow runs the approval only when no matching file changed. The caller
supplies the approval action, so the same policy runs locally and in the
GitHub App:

[`workflow.ts`](./workflow.ts "source {8}")

## Preview it locally

Create `.cloudflare/ci/workflow.ts`. Its approval action only prints the
decision and writes no GitHub review:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Try it

```sh
node examples/small-change/demo.ts
```

The local demo prints which changes would receive approval; it sends no GitHub
reviews. To apply the policy to your own branch:

```sh
cd examples/small-change
effect-ci run
```

The local workflow compares committed changes with the remote default branch and
only prints the approval. A dirty checkout or unknown comparison leaves normal review.

## Approve through the GitHub App

The [GitHub App integration](../../apps/effect-ci/src/workflows/pull-request.ts)
supplies the real approval. The [demo](./demo.ts) shows the wiring: its approval
action reads the PR evidence, rechecks it before writing, and then approves:

[`demo.ts`](./demo.ts#symbol=smallChangeExample "source 'approveSmallChanges(approve)'")
