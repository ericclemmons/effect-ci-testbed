# Discover checks automatically

Already have package scripts? Run them without writing a workflow.

From this example directory:

```sh
pnpm exec cf-ci run
pnpm exec cf-ci list
pnpm exec cf-ci plan --format=mermaid
pnpm exec cf-ci run lint
```

The CLI detects the package manager and conventional format, lint, check,
typecheck, test, and build scripts. Installation and script ordering appear in
the plan.

The first local `run` creates an empty `.cloudflare/ci/ci.ts` marker when no
workflow exists. `plan` and `list` do not create files.

Add [.cloudflare/ci/workflow.ts](../node-pnpm/.cloudflare/ci/workflow.ts) when you
need custom ordering or parallelism; it replaces script discovery.

## Own the Cloudflare host

The [standalone host](./hosted/README.md) reads this fixture's package scripts
from the requested full GitHub commit. Hosting dependencies and build scripts
live in `hosted/`, not in the package being discovered. No local workflow is
added. Independent deployment and execution remain unverified; the retained
shared-host history is not proof for this host.
