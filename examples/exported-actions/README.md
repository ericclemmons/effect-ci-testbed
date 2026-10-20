# Run a single check from the CLI

Expose useful goals without exposing every setup step.

```ts
export { check } from "./actions.ts"
export default CI.workflow("exported-actions", () => actions.check())
```

From this example directory:

```sh
pnpm exec cf-ci list
pnpm exec cf-ci run check
```

`check` runs its checkout prerequisite automatically. Checkout remains private:
only named `CI.action` exports become CLI targets.

[Workflow](./.cloudflare/ci/workflow.ts) · [Actions](./.cloudflare/ci/actions.ts)
