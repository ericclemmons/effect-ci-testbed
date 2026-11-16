# Run CI on Blacksmith

Use Blacksmith's compute with the same workflow you run locally.

No provider-specific code goes into the Effect workflow. Only the GitHub caller
names the Blacksmith runner.

The snippets on this page come from this example's files, which CI runs end to
end.

## Keep the workflow unchanged

The actions are the same ones the [runner selection](../runner-selection)
example uses. Compute selection does not change them:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source")

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Choose Blacksmith in the GitHub caller

Add a GitHub workflow that calls the reusable Effect CI runner and passes
`blacksmith-2vcpu-ubuntu-2404` as `runs-on`:

[`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml "source {17}")

## Try it

```sh
cd examples/blacksmith
effect-ci run
```

For hosted execution, enable Blacksmith for your organization and repository,
then place the comparison workflow in the repository-root `.github/workflows`.
See [Blacksmith setup](https://docs.blacksmith.sh/introduction/quickstart).

This testbed has not run the example on Blacksmith. The local command needs no
Blacksmith account.

## Compare with GitHub Actions

The same test as a plain GitHub Actions job on Blacksmith:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L16-L26 "source {3}")
