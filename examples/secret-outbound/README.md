# Call authenticated APIs without exposing credentials

Let a container request an authenticated operation while the credential stays
with the host.

The command sends a placeholder to `http://credential.ci/verify`. The
[host proxy](../../test/apps/example-runner/src/secret-outbound.ts) accepts that
fixed operation, substitutes its credential, and returns only a success bit.

The snippets on this page come from this example's files and its host, which CI
runs end to end.

## Call the virtual hostname from a check

In `.cloudflare/ci/actions.ts`, the command sends a placeholder bearer token to
`credential.ci`. It also fails if the credential appears in its environment:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source 'http://credential.ci/verify'")

The workflow runs that check:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Intercept the hostname on the host

The host's container class routes outbound HTTP for `credential.ci` to a host
entrypoint, keyed to this container:

[Host container](../../test/apps/example-runner/src/secret-outbound.ts#symbol=SecretWorkspaceContainer "source 'interceptOutboundHttp'")

The entrypoint replaces the placeholder with the host-held credential and
forwards the request:

[Credential proxy](../../test/apps/example-runner/src/secret-outbound.ts#symbol=SecretOutbound "source")

The example keeps an inert per-container test credential in a Durable Object.
A real integration should resolve its own host-held secret and restrict the
allowed operation:

[Test credential vault](../../test/apps/example-runner/src/secret-outbound.ts#symbol=CredentialVault "source")

The host Workflow runs the Effect CI workflow in that container:

[Host Workflow](../../test/apps/example-runner/src/secret-outbound.ts#symbol=SecretOutboundWorkflow "source")

## Run in the local Cloudflare runtime

This Worker serves the same host classes under `wrangler dev`:

[`src/worker.ts`](./src/worker.ts "source")

[`wrangler.jsonc`](./wrangler.jsonc "source")

```sh
pnpm --filter effect-ci-secret-outbound-fixture dev
pnpm --filter effect-ci-secret-outbound-fixture exec wrangler workflows trigger effect-ci-secret-outbound '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' --local
```

The local Container runtime intercepts `credential.ci` too, so the request is
authenticated without the credential entering the container.

## Run on Cloudflare

After configuring the [example host](../../test/apps/example-runner):

```sh
cf workflows instances create effect-ci-example-secret-outbound --body '{"instance_id":"secret-outbound-1","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
```

## Limits

The virtual hostname requires the host interceptor; `effect-ci run` without a
Container does not provide it. Other internet access is not blocked by this example.
