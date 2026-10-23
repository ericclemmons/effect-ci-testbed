# Short-lived Cloudflare credentials for GitHub Actions

Keep your existing deployment steps. Add the [authentication action](../../.github/actions/cloudflare-auth/action.yml)
to request a 15-minute token scoped to exactly one Worker. OIDC is part of this
GitHub runner app; it works with `runs-on: ubuntu-latest` and needs no runner Container.
The native host's `cf-ci run --remote` remains a separate execution path.

## Try the examples in this repository

On the integrated proof branch:

```sh
gh workflow run oidc-live-proof.yml --ref codex/oidc-runner-integration -f example=both
gh run list --workflow oidc-live-proof.yml --branch codex/oidc-runner-integration
```

Use `example=wrangler` or `example=cf` to select one. Each job exchanges GitHub OIDC,
checks its own Worker (200), the other Worker (403) and R2 listing (403), deploys with
its ordinary CLI, verifies the response, and revokes its token. No long-lived
Cloudflare credential is stored in GitHub. Grants authorize this repository and
this exact workflow/ref; a fork needs its own setup.

## Use your self-hosting account

After the [native host setup](../effect-ci/SELF-HOST.md), from the repository root:

```sh
cd apps/github-actions-runner
pnpm run setup:oidc -- --repository OWNER/REPO --ref main
```

Setup reads `../effect-ci/.env.production` for the account and `workers.dev`
subdomain, discovers repository IDs and Worker tags using `gh` and `cf`, generates
this app's ignored `.env.production`, and sets the public GitHub repository variable
`EFFECT_CI_OIDC_BROKER_URL`. It copies no native API token or Access credentials.
Use `--host-env FILE` for another configuration, or `--account ID --subdomain NAME`
without deploying the native host. `gh` and `cf` must already be authenticated.

The default targets are `effect-ci-oidc-wrangler` and `effect-ci-oidc-cf`. Bootstrap
them once with operator credentials in the selected account before setup; Editor can
update an existing Worker but cannot create one. Use repeated `--worker NAME` flags
for different targets, and `--workflow .github/workflows/deploy.yml` for another workflow.
Missing Workers or an account change fail rather than broadening permissions.

The broker needs a separate account-owned issuer with **Account API Tokens Write**.
Save it as `CLOUDFLARE_TOKEN_ISSUER` in this app's `.env.production`, then:

```sh
pnpm run deploy
```

Setup defaults `EFFECT_CI_OIDC_ONLY=true`, so this deploy builds no runner image.
For full Actions execution, configure the normal [runner enrollment](./README.md)
and set that flag to `false`. Both capabilities then share this Worker. Issuer and
GitHub App secrets remain in the trusted host; they never enter runner Containers.
Do not add an Access service-token requirement to `/token` or `/revoke`: these routes
verify OIDC and signed cleanup receipts themselves.

OAuth with `account_api_tokens:create` enabled token API access in the verified
account, but could not select **Individual Workers Editor** or create the issuer.
The dashboard-created issuer could select the required Worker role. Creating issuer
authority is the one-time HITL step. [Cloudflare provisioning documentation](https://developers.cloudflare.com/changelog/post/2026-10-01-account-api-token-provisioning/).

## Scope policy

The action requests `worker` and space-separated `scopes`, without a named profile.
The broker authorizes immutable repository/owner IDs, exact branch/workflow ref and
Worker, then includes only requested policies from the operator's allowlist.
`workers:edit` maps to **Individual Workers Editor** on the immutable Worker tag.
There is no R2, KV, D1 or account-wide Workers permission by default. Add other scopes
only with explicitly authorized Cloudflare policies; resource granularity varies by product.

GitHub signatures use cached JWKS, exact issuer/audience and a ten-minute maximum
identity age. Each JWT ID can issue once through a Durable Object. Tokens expire after
15 minutes; post-job cleanup revokes them with a signed receipt. The DO stores token IDs,
never values. Broker errors expose only fixed failure categories. Deployment uploads
only allowlisted runner/OIDC secrets, excluding operator API and Access credentials.

## Evidence and checks

[Original successful run](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/39880677228)
· [receipt](./verification/oidc/live.json) · [grants](./verification/oidc/grants.json).
That proof used the original standalone deployment; its source now lives in this app.
The strengthened runtime test mounts OIDC through the actual GitHub runner entrypoint,
using real Workers fetch with only outbound services mocked. Setup tests cover generated
self-hosting configuration, account isolation and deployment secret filtering.

```sh
pnpm test
pnpm check
EFFECT_CI_OIDC_ONLY=true pnpm build
```

Tokens do not refresh during jobs longer than 15 minutes. Per-identity rate limits,
durable audit history and account-token quota handling remain follow-up work. The
prototype issuer expires October 29, 2026. No destructive cross-Worker or R2 content
operations were tested. No production-readiness or video proof is claimed.
