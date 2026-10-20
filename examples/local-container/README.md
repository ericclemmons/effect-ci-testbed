# Run CI in a local container

Keep CI's tools and system packages out of your machine.

The [workflow](./.cloudflare/ci/workflow.ts) selects `node:24-bookworm`. Effect CI
starts one Docker container, mounts the example at `/workspace`, and runs its
actions there. Source edits remain visible on the host.

## Run it

With Docker running:

```sh
pnpm exec cf-ci run --workflow examples/local-container/.cloudflare/ci/workflow.ts
```

Planning does not start a container:

```sh
pnpm exec cf-ci plan --workflow examples/local-container/.cloudflare/ci/workflow.ts
```

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub job-container comparison](./.github/workflows/github.yml)
