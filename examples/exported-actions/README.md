# Run a single check from the CLI

Expose useful goals without exposing every setup step.

[Source](./.cloudflare/ci/workflow.ts "source")

From the repository root:

```sh
cd examples/exported-actions
effect-ci list
effect-ci run check
```

`check` runs its checkout prerequisite automatically. Checkout remains private:
only named `CI.action` exports become CLI targets.

[Workflow](./.cloudflare/ci/workflow.ts) · [Actions](./.cloudflare/ci/actions.ts)

Use the same exported goal on your configured hosted service from the repository root:
`effect-ci run check --remote --workflow examples/exported-actions/.cloudflare/ci/workflow.ts`.
No recipe-specific deployment is required; remote execution uses the pushed commit.

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs the same `node --check
app/index.js` as the GitHub Actions comparison. It has no command for running
one check by name. It does not use Effect CI.

```sh
(cd examples/exported-actions/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs exported-actions
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
