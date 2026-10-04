# Deploy dependent applications in order

> How do I guarantee that the backend deploys before the frontend that consumes it?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_build_applications["build applications"]
  step_deploy_backend["deploy backend"]
  step_deploy_frontend["deploy frontend"]
  step_checkout --> step_build_applications
  step_build_applications --> step_deploy_backend
  step_deploy_backend --> step_deploy_frontend
```

---

The outer deployment owns the ordering constraint:

```text
checkout → build applications → deploy backend → deploy frontend
```

`deployFrontend()` yields `deployBackend()`, which yields `build()`. The workflow only
needs to request the final desired state. Running `cf-ci run deployFrontend` directly
has the same prerequisites, and a planner can render the dependency edges without AST
or closure analysis.

The fixture records deployment order locally and rejects an out-of-order frontend
deployment. The commands are harmless stand-ins for two Wrangler deployments.

Compare the conventional [GitHub Actions workflow](./.github/workflows/github.yml) with
the portable [actions](./.cloudflare/ci/actions.ts) and
[workflow](./.cloudflare/ci/workflow.ts).
