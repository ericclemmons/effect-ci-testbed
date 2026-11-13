# Use secrets without exposing them to containers

Declare the credential an action needs without putting its value into plans,
logs, or command environments.

The runner resolves a redacted value. Consume it through a trusted host-side
capability—not by interpolating it into a shell command.

The snippets on this page come from this example's files and its host, which CI
runs end to end.

## Declare the secret in an action

In `.cloudflare/ci/actions.ts`, ask for the secret by name with `CI.Secret`. The
action returns an Effect `Redacted<string>`, so its value stays out of plans and
logs:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source 'CI.Secret(\"GITHUB_TOKEN\")'")

The workflow runs that action:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Try it

With an inert test value in `GITHUB_TOKEN`:

```sh
cd examples/secure-secrets
effect-ci run
```

## Resolve the secret on a host

Local resolution uses the process environment. The host adapter supplies its own
resolver, backed by a Worker secret binding. The value stays in trusted
Worker memory:

[Host adapter](../../test/apps/example-runner/src/secure-secrets.ts#symbol=SecureSecretsWorkflow "source 'secrets:'")

[Outbound authentication](../secret-outbound) shows how a workload can request
an authenticated operation without receiving the credential.

## Compare with GitHub Actions

GitHub Actions passes the secret into the step's environment, where the command
can read it:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L17-L20 "source")
