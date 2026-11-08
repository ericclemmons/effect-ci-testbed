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

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs `npm ci`, the Linux
check, and `npm test` in order. The comparison job uses `node:24-bookworm`; the
managed `workflows/node` image is Debian trixie with Node.js 24. It does not use
Effect CI.

```sh
(cd examples/local-container/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs local-container
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
