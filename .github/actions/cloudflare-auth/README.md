# Cloudflare authentication for GitHub Actions

This action gives subsequent job steps temporary Cloudflare credentials. Normal
deployment commands such as `cf deploy` do not need an authentication wrapper.
Grant the job `id-token: write`; no Cloudflare or Access secret belongs in GitHub.

[Tutorial workflow](../../../examples/demo/tutorial/oidc.example.yml "source")

## Shared host

Set `enroll: "true"` to enroll the current `GITHUB_REPOSITORY` before exchanging
its signed identity. The host independently checks the GitHub App installation
and allowed numeric owner. Copying the action does not grant authority.

The service origin is read in this order: the `broker-url` action input,
`EFFECT_CI_REMOTE_URL` in the job environment, that key in the checkout's `.env`,
then `issuer` in `.cloudflare/ci/oidc.json`. These files store public configuration,
not credentials. The action reads them from `GITHUB_WORKSPACE`.

The `worker` and `scopes` inputs request the operator's allowed policy. Scopes
default to `workers:edit`. On the shared host, account-scoped Workers Scripts Write
permits creating a new Worker without bootstrap. A Worker name does not narrow
that account-wide policy to one Worker. The host operator owns that trust decision.

## Credential lifetime and cleanup

The action masks the token and cleanup receipt, exports `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` through `GITHUB_ENV`, and saves only cleanup state for
its post hook. The post hook runs even if a later step fails. Revocation failure
fails cleanup; the token still expires within 15 minutes of issuance. Abruptly
terminated jobs rely on that expiry if the post hook cannot run.

## Legacy broker

Existing workflows may keep their explicit `broker-url`, exact `worker`, and
scopes. Enrollment defaults to false so a legacy broker is not sent a shared-host
enrollment request. Legacy grant policy remains owned by that broker.
