# Run CI in a local container

Keep CI's tools and system packages out of your machine.

The workflow selects `node:24-bookworm`. Effect CI starts one Docker container,
mounts the example at `/workspace`, and runs its actions there. Source edits
remain visible on the host.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts` with your usual actions. Nothing in them
refers to the container. This example adds one action that proves the commands
run on Linux:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=verifyContainer "source")

It also defines `checkout`, `install`, and `test`, as in the
[npm example](../node-npm). See the [full actions file](./.cloudflare/ci/actions.ts).

## Select the container in the workflow

Create `.cloudflare/ci/workflow.ts`. Export a `local` runner that names the
image. `effect-ci run` uses it for local runs:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source {2,12-13}")

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

## Compare with GitHub Actions

A GitHub job container does the same with `container:`:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L11-L19 "source {4}")
