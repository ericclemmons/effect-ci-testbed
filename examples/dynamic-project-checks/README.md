# Test untrusted code without a container

Check a project's HTTP handler without giving its code access to the CI host.

The workflow reads two project modules as text, then asks the isolated
`ProjectChecks` service to assert status codes and response bodies. Each
assertion runs in a fresh Worker with no host bindings or outbound network.

The snippets on this page come from this example's files, which CI runs end to
end.

## Start with your project's handler

The project exports a Worker-compatible `fetch` handler. This example's handler
also reports its bindings and whether outbound `fetch` works, so the checks can
prove both are withheld:

[`app/index.js`](./app/index.js "source")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. Start with the imports, including the
project checks module:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#L1-L3 "source {2}")

Check out the source:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#symbol=checkout "source")

The check reads each project module as text, then passes the modules and
expected responses to `ProjectChecks`. Planning declares the dependency but does
not run project code:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#symbol=check "source {5} 'workspace.readFile' 'Dynamic.ProjectChecks'")

Run the check:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts#symbol=default "source")

## Run it

```sh
cd examples/dynamic-project-checks
effect-ci run
```

The CLI starts a local workerd service automatically. No Docker or Cloudflare
account is needed.

## Run it on Cloudflare

On Cloudflare, the Worker supplies WorkerLoader instead. Add a `LOADER` binding
and the Workflow in `cloudflare.config.ts`:

[`cloudflare.config.ts`](./cloudflare.config.ts "source 'bindings.workerLoader()'")

The [Worker adapter](./src/worker.ts) provides `ProjectChecks` from that
binding and runs the workflow. Its workspace can only read the two fixture
modules and cannot run container commands:

[`src/worker.ts`](./src/worker.ts#symbol=ProjectWorkflow "source 'Dynamic.makeProjectChecks(this.env.LOADER)' 'Effect.provideService(Dynamic.ProjectChecks'")

## Limits

This example supports Worker-compatible ESM, not arbitrary Node packages,
Vitest, native executables, or a Vite build. Source is limited to 16 modules /
64 KiB. Project modules remain data until they enter the isolated Worker.
