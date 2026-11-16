# Run required and optional checks

Run lint and formatting together, without letting advisory formatting block CI.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the checks

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the source and install dependencies once:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source")

Define each check with `CI.check`. A check runs a command and returns no value.
Both run a package script on the installed workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=lint "source 'CI.check'")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=format "source 'CI.check'")

Nothing in the checks says which one is optional. The workflow decides that.

## Mark a check optional in the workflow

Create `.cloudflare/ci/workflow.ts`. `CI.parallel` runs both checks at once, and
`CI.optional` turns a format failure into a warning:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {8}")

## Run it

```sh
cd examples/optional-checks
effect-ci run
```

Formatting deliberately fails; lint passes, so the run succeeds. Remove
`CI.optional` or fail lint and the workflow fails.

## Compare with GitHub Actions

GitHub Actions marks the format step with `continue-on-error`:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L11-L27 "source")
