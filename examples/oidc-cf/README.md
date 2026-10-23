# Deploy with cf using short-lived credentials

> Can I keep my GitHub Actions deployment and replace its stored Cloudflare secret with a temporary token?

Yes: add the Effect CI authentication action, then keep `cf deploy`.
Execution stays in GitHub Actions. The shared [Effect CI OIDC broker](../../apps/oidc-broker/README.md)
verifies GitHub identity and creates a 15-minute account-owned Cloudflare token.
The action exports `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for later steps,
then revokes the token in its post-job cleanup. No Cloudflare secret lives in GitHub.
The broker retains a separate token-creation credential.

## Run it

1. Follow the broker's one-time setup. Bootstrap the existing Worker named
   `effect-ci-oidc-cf` with your operator credentials (`pnpm --dir examples/oidc-cf deploy`
   from the repository root). The Editor role can update it but cannot create it.
2. Configure a broker grant for that exact Worker and repository identity, allowing
   only `workers:edit`, backed by an **Individual Workers Editor** policy copied
   from a token scoped to this Worker. There is no R2, KV, D1, route, or account-wide
   Workers permission in this example.
3. Copy [the workflow](./.github/workflows/deploy.yml) to the repository's root
   `.github/workflows/oidc-cf.yml`. GitHub does not discover workflows nested inside
   examples. Set the repository variable `EFFECT_CI_OIDC_BROKER_URL` to the deployed
   broker's HTTPS origin and authorize the copied workflow's exact `workflow_ref`.
4. Dispatch that workflow on the allowed branch. The deploy step uses its ordinary
   `pnpm run deploy` command. Cleanup revokes the credential; expiration limits its
   lifetime if the runner is interrupted.

The checked-in workflow runs in this monorepo. For another repository, copy the
Worker files and adjust the working directory and install commands. Reference the
shared action as `ericclemmons/effect-ci-testbed/.github/actions/cloudflare-auth@COMMIT_SHA`
using the actual reviewed commit containing it. No action version has been published.

```yaml
permissions:
  contents: read
  id-token: write

# Inside the existing job's steps, before deploying:
# - uses: actions/checkout@v7
# - uses: ./.github/actions/cloudflare-auth
#   with:
#     broker-url: ${{ vars.EFFECT_CI_OIDC_BROKER_URL }}
#     worker: effect-ci-oidc-cf
#     scopes: workers:edit
# - run: pnpm run deploy
```

## Custom scopes

The action requests `worker` and space-separated `scopes`, not a named profile.
Scopes are Effect CI names mapped to exact Cloudflare API policies by the operator.
Requests must be a subset of the identity's allowlist; unrecognized scopes and other
Workers fail before token creation. If a job needs R2 later, add an explicit scope
and approved policy, then request it. Omitted scopes are never added automatically.
Cloudflare's resource granularity varies by product; naming an Effect CI scope does
not create a resource restriction that Cloudflare itself cannot enforce.

The Worker has no storage bindings or routes. This isolates the first proof to
updating an existing Worker. Changing routes, provisioning storage or deploying the
full hosted Effect CI app requires separately approved permissions.

## Verification proof

**Video:** Pending — the live run is verified in GitHub Actions logs; no video has been recorded.

**Measured results:** [Live run receipt](../../apps/oidc-broker/verification/live.json)
— 27 seconds for this GitHub job, including setup and cleanup (one run, not a benchmark).
Follow the [proof-page contract](../PROOF-PAGES.md).

[GitHub Actions run 39880677228](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/39880677228)
verified a real GitHub OIDC exchange, a 15-minute **Individual Workers Editor** token,
this Worker's source read (200), the other example's source read (403), and R2 bucket
listing (403). Ordinary `cf deploy` published version `2f474bcc-f15d-4143-8eb3-2df358e2fb4f`;
the served response matched and the action revoked its token. An independent issuer
metadata read found no remaining tokens for that run. The broker ran version
`37676665-fe30-4f34-845f-9c6ac29dd070`.

This proof used the dedicated `codex/oidc-live-proof` branch and root proof workflow,
with exact identity grants recorded beside the receipt. The nested example workflow
is the copyable starting point and needs its own authorized ref. Execution stayed in
GitHub; Cloudflare hosted only the credential broker and deployment targets. No R2
content operations, destructive cross-Worker requests or automatic token renewal were tested.

Local checks from the repository root:

```sh
pnpm --dir apps/oidc-broker test
node --test .github/actions/cloudflare-auth/client.test.mjs
pnpm --dir examples/oidc-cf build
```
