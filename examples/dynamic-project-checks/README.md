# Test untrusted code without a container

Check a project's HTTP handler without giving its code access to the CI host.

The [workflow](./.cloudflare/ci/workflow.ts) reads two project modules as text,
then asks the isolated `ProjectChecks` service to assert status codes and
response bodies. Each assertion runs in a fresh Worker with no host bindings
or outbound network.

## Run it

```sh
pnpm exec cf-ci run --workflow examples/dynamic-project-checks/.cloudflare/ci/workflow.ts
```

The CLI starts a local workerd service automatically. No Docker or Cloudflare
account is needed. On Cloudflare, the [Worker adapter](./src/worker.ts) supplies
WorkerLoader instead.

This example supports Worker-compatible ESM, not arbitrary Node packages,
Vitest, native executables, or a Vite build. Source is limited to 16 modules /
64 KiB. Project modules remain data until they enter the isolated Worker.
