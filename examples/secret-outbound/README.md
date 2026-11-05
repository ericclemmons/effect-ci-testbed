# Call authenticated APIs without exposing credentials

Let a container request an authenticated operation while the credential stays
with the host.

The command sends a placeholder to `http://credential.ci/verify`. The
[host proxy](../../test/apps/example-runner/src/secret-outbound.ts) accepts that
fixed operation, substitutes its credential, and returns only a success bit.

## Run in the local Cloudflare runtime

```sh
pnpm --filter effect-ci-secret-outbound-fixture dev
pnpm --filter effect-ci-secret-outbound-fixture exec wrangler workflows trigger effect-ci-secret-outbound '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' --local
```

[This Worker](./src/worker.ts "source") serves the same host classes under `wrangler dev`.
The local Container runtime intercepts `credential.ci` too, so the request is
authenticated without the credential entering the container.

## Run on Cloudflare

After configuring the [example host](../../test/apps/example-runner):

```sh
cf workflows instances create effect-ci-example-secret-outbound --body '{"instance_id":"secret-outbound-1","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
```

The example uses an inert per-container test credential. A real integration
should resolve its own host-held secret and restrict the allowed operation.

The virtual hostname requires the host interceptor; `effect-ci run` without a
Container does not provide it. Other internet access is not blocked by this example.
