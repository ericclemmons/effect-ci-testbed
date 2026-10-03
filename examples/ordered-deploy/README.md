# Deploy dependent applications in order

This example answers one question:

> How do I guarantee that the backend deploys before the frontend that consumes it?

The outer deployment owns the ordering constraint:

```text
checkout → build applications → deploy backend → deploy frontend
```

`deployFrontend()` yields `deployBackend()`, which yields `build()`. The workflow only
needs to request the final desired state. Running `workflow.ts deployFrontend` directly
has the same prerequisites, and a planner can render the dependency edges without AST
or closure analysis.

The fixture records deployment order locally and rejects an out-of-order frontend
deployment. The commands are harmless stand-ins for two Wrangler deployments.

Compare the conventional [GitHub Actions workflow](./.github/workflows/github.yml) with
the portable [actions](./.cloudflare/ci/actions.ts) and
[workflow](./.cloudflare/ci/workflow.ts).
