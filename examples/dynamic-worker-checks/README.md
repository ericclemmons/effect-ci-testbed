# Format code without a container

Run a formatter in a Worker isolate instead of starting a container.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the format check

Create `.cloudflare/ci/actions.ts`. Start with the imports. `Tools` provides the
formatter:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1-L3 "source {3}")

Check out the source:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source")

Read the file as text, format it, and fail if the result differs. Project source
is input text, not code executed by the formatter's host:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=format "source 'Tools.format'")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Run it

```sh
cd examples/dynamic-worker-checks
effect-ci run
```

Local execution uses Prettier.

## Run it on Cloudflare

The Cloudflare adapter runs the formatter in a separate Dynamic Worker, with no
secrets or outbound network. Add a `LOADER` binding and the Workflow in
`cloudflare.config.ts`:

[`cloudflare.config.ts`](./cloudflare.config.ts "source 'bindings.workerLoader()'")

The [Worker](./src/worker.ts) provides `SourceTools` from that binding and runs
the workflow. Its workspace can only read the fixture file and cannot run
container commands:

[`src/worker.ts`](./src/worker.ts#symbol=FormatterWorkflow "source 'Dynamic.makeSourceTools(this.env.LOADER)' 'Effect.provideService(Tools.SourceTools'")

## Limits

The included assertion adapter also supports a bounded `toBe`/`toEqual`/`.not`
subset. It is not the full Vitest runner. The pinned Oxfmt/Oxlint native tools
cannot run through this isolate path; use a container for those tools.

See also [Isolated project HTTP tests](../dynamic-project-checks).
