# Legacy runner credential exchange

New projects use the [shared CI app](../effect-ci/README.md#unified-cli-and-workload-identity)
and `cf-ci oidc`, including `cf-ci run --remote`. See the canonical
[Wrangler](../../examples/oidc-wrangler/README.md) and
[cf](../../examples/oidc-cf/README.md) examples. They support new Worker creation
and repository self-enrollment without a deployment action or a separate broker URL.

The remainder records the older single-Worker runner implementation and its
historical evidence. Its bootstrap requirement and exact workflow/ref grants do
not describe the shared app's account-wide owner enrollment.

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
for different targets. By default, setup authorizes `.github/workflows/e2e.yml`
and `.github/workflows/oidc-live-proof.yml` on the selected branch. Use repeated
`--workflow PATH` and `--ref BRANCH` flags for explicit alternatives; they replace
the defaults and authorize only those exact pairs.
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

[Consolidated app run](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/39884915360)
· [integration receipt](./verification/oidc/integration.json). Both examples passed,
including scope probes, normal CLI deployment, served response and token revocation;
account token metadata independently confirmed zero remaining credentials. This branch
includes the merged self-hosting PR #393.

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
