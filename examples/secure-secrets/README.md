# Use secrets without exposing them to containers

Declare the credential an action needs without putting its value into plans,
logs, or command environments.

[Source](./.cloudflare/ci/actions.ts#symbol=authenticate "source")

The runner resolves a redacted value. Consume it through a trusted host-side
capability—not by interpolating it into a shell command.

## Try it

With an inert test value in `GITHUB_TOKEN`:

```sh
pnpm exec cf-ci run --workflow examples/secure-secrets/.cloudflare/ci/workflow.ts
```

Local resolution uses the process environment. The
[host adapter](../../test/apps/example-runner/src/secure-secrets.ts) uses a Worker
secret binding. [Outbound authentication](../secret-outbound) shows how a workload
can request an authenticated operation without receiving the credential.
