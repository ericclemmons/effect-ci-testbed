# Call authenticated APIs without exposing credentials

Let a container request an authenticated operation while the credential stays
with the host.

The command sends a placeholder to `http://credential.ci/verify`. The
[host proxy](../../test/apps/example-runner/src/secret-outbound.ts) accepts that
fixed operation, substitutes its credential, and returns only a success bit.

## Run on Cloudflare

After configuring the [example host](../../test/apps/example-runner):

```sh
cf workflows instances create effect-ci-example-secret-outbound --body '{"instance_id":"secret-outbound-1","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"FULL_COMMIT_SHA"}}'
```

The example uses an inert per-container test credential. A real integration
should resolve its own host-held secret and restrict the allowed operation.

## Run locally

Preload the public `node:24-alpine` Docker image, then run:

```sh
EFFECT_CI_OUTBOUND_RECEIPT=/tmp/secret-outbound.json pnpm exec cf-ci run --workflow examples/secret-outbound/.cloudflare/ci/workflow.ts
```

[Local host adapter](./.cloudflare/ci/local.ts "source")

The host creates an inert credential and a loopback upstream. The read-only
container has no host mounts or inherited host environment. Node's explicit HTTP
proxy sends the placeholder to the host, which substitutes the credential and
returns only `{ authenticated: true }`. Wrong placeholders, paths and queries
are rejected. Even an upstream that reflects the credential cannot return it to
the workload. The host removes the container and closes both listeners on exit.

This is an opt-in Node proxy, not transparent interception for arbitrary programs
or a VM-wide firewall. The proxy serves only `credential.ci:80`; it does not
tunnel to external destinations. Other internet access is not blocked. The
receipt records the actual image digest and host platform; it does not prove an
external API integration. See [evidence and limits](../remaining-coverage.md).
The proxy listener binds host interfaces so Docker can reach it. Use only the
inert fixture credential here, not a production secret.
