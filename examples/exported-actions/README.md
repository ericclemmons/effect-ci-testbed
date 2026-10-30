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
