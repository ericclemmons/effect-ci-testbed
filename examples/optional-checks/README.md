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

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs lint and format in
parallel with Cloudflare Workflows `step.runner()`. Format is marked optional, so
its deliberate failure is reported without failing the run. It does not use
Effect CI.

```sh
(cd examples/optional-checks/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs optional-checks
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
