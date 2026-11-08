# Format code without a container

Run a formatter in a Worker isolate instead of starting a container.

[Source](./.cloudflare/ci/actions.ts#symbol=format "source")

## Run it

```sh
cd examples/dynamic-worker-checks
effect-ci run
```

Local execution uses Prettier. The [Cloudflare adapter](./src/worker.ts) runs
the formatter in a separate Dynamic Worker, with no secrets or outbound network.
Project source is input text, not code executed by the formatter's host.

The included assertion adapter also supports a bounded `toBe`/`toEqual`/`.not`
subset. It is not the full Vitest runner. The pinned Oxfmt/Oxlint native tools
cannot run through this isolate path; use a container for those tools.

[Actions](./.cloudflare/ci/actions.ts) · [Isolated project HTTP tests](../dynamic-project-checks)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs the same pinned Prettier
check as the GitHub Actions comparison inside a container. It does not use a
Dynamic Worker. It does not use Effect CI.

```sh
(cd examples/dynamic-worker-checks/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs dynamic-worker-checks
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
