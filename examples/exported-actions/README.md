# Run a single check from the CLI

Expose useful goals without exposing every setup step.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import and a checkout
action:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Add the check you want to run by name. It yields `checkout`, so checkout runs
first:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=check "source {2}")

## Export the goal from the workflow

Create `.cloudflare/ci/workflow.ts`. Only named `CI.action` exports from the
workflow file become CLI targets. This one exports `check` and not `checkout`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {7}")

## Run it

From the repository root:

```sh
cd examples/exported-actions
effect-ci list
effect-ci run check
```

`check` runs its checkout prerequisite automatically. Checkout remains private.

Use the same exported goal on your configured hosted service from the repository root:
`effect-ci run check --remote --workflow examples/exported-actions/.cloudflare/ci/workflow.ts`.
No recipe-specific deployment is required; remote execution uses the pushed commit.
