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
