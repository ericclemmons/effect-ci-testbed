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
