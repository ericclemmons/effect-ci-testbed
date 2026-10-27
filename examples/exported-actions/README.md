# Run a single check from the CLI

Expose useful goals without exposing every setup step.

[Source](./.cloudflare/ci/workflow.ts "source")

From this example directory:

```sh
pnpm exec cf-ci list
pnpm exec cf-ci run check
```

`check` runs its checkout prerequisite automatically. Checkout remains private:
only named `CI.action` exports become CLI targets.

[Workflow](./.cloudflare/ci/workflow.ts) · [Actions](./.cloudflare/ci/actions.ts)

## Own the Cloudflare host

The [standalone host](./hosted/README.md) runs this default workflow without the
shared example app. It owns its config, Container binding and Dockerfile.
It does not expose a remote target-discovery endpoint. Independent deployment
and execution remain unverified.
