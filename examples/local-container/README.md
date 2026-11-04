# Run CI in a local container

Keep CI's tools and system packages out of your machine.

The [workflow](./.cloudflare/ci/workflow.ts) selects `node:24-bookworm`. Effect CI
starts one Docker container, mounts the example at `/workspace`, and runs its
actions there. Source edits remain visible on the host.

## Run it

With Docker running:

```sh
cd examples/local-container
effect-ci run
```

Planning does not start a container:

```sh
effect-ci plan
```

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub job-container comparison](./.github/workflows/github.yml)
