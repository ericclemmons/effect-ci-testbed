# Let authors self-merge safe changes

Not every PR needs the same approval policy. Let the GitHub App approve changes
your team considers safe, so authors and agents can self-merge once all checks pass.

Here we arbitrarily define “safe” as **no code changes**: no `.ts`, `.tsx`, or
`.json` files changed. Choose a different rule if that better fits your project.

```ts
const source = yield* CI.Source
if (!(yield* source.changed("**/*.(ts|tsx|json)"))) {
  yield* approve()
}
```

The trusted workflow chooses the policy—not the PR being reviewed. Other GitHub
merge requirements still apply. This grants approval; it does not merge the PR.

## Try it

```sh
node examples/small-change/demo.ts
```

The local demo prints which changes would receive approval; it sends no GitHub
reviews. Read the [workflow](./workflow.ts) and the
[GitHub App integration](../../apps/effect-ci/src/workflows/pull-request.ts).
