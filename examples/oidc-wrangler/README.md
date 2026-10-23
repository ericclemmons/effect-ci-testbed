# Deploy with wrangler using OIDC

> How do I deploy with `wrangler deploy` from GitHub Actions without storing a Cloudflare API token?

Configure Cloudflare credentials with OIDC, then run your usual deployment command.
The authentication step exports `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`;
`wrangler` reads them from the environment. The credential expires after 15 minutes,
and the action revokes it when the job finishes.

## GitHub Actions workflow

After checkout and dependency installation, the deployment steps are:

```yaml
permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      # Install Node, pnpm, and project dependencies as in your existing workflow.
      - name: Configure Cloudflare credentials
        uses: ./.github/actions/configure-cloudflare-credentials
        with:
          worker: effect-ci-oidc-wrangler
          scopes: workers:edit
      - name: Deploy with wrangler
        working-directory: examples/oidc-wrangler
        run: pnpm exec wrangler deploy
```

See the [complete runnable workflow](./.github/workflows/deploy.yml) for this monorepo.
The same credentials work with other Cloudflare CLI commands in subsequent steps.
This follows the authentication-then-CLI pattern of
[AWS configure credentials](https://github.com/aws-actions/configure-aws-credentials).

## Try this prototype

The action in this repository implements the proposed user experience. It is an
Effect CI prototype, not a published Cloudflare action or built-in CLI OIDC support.
It uses the deployed prototype credential service by default. A repository must
have a matching trust grant before it can obtain credentials; an arbitrary fork
cannot deploy to the example Worker.

1. Have the account owner authorize your repository, branch, exact workflow ref,
   Worker, and allowed permissions in the credential service's trust policy.
   The example updates the existing `effect-ci-oidc-wrangler` Worker with only
   `workers:edit`. Create the Worker once with operator credentials if needed.
2. Copy the workflow to the repository root as `.github/workflows/oidc-wrangler.yml`;
   GitHub does not discover workflows nested inside examples. Authorize that
   copied workflow's exact ref, then dispatch it on the allowed branch.
3. For another repository, copy the Worker files and adjust installation and working
   directory settings. Reference the action as
   `ericclemmons/effect-ci-testbed/.github/actions/configure-cloudflare-credentials@COMMIT_SHA`,
   replacing `COMMIT_SHA` with a reviewed commit containing the action. No action
   version has been published.

The service handles GitHub identity verification and temporary token issuance.
Account owners can find provisioning, scope mapping, and self-hosting instructions
in the [credential service operator guide](../../apps/oidc-broker/README.md).
Self-hosted installations can override the action's optional `broker-url` input;
it is unnecessary for the default service.

`workers:edit` is this prototype's permission name and maps to an **Individual
Workers Editor** policy for exactly this Worker. Additional products such as R2,
KV, D1, or routes need explicit trust-policy permissions and requested scopes.
The service retains the token-creation credential; GitHub stores no Cloudflare secret.

## Verification proof

[Updated workflow proof, run 40025873110](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/40025873110/attempts/2)
passed with the default service endpoint and explicit CLI deployment commands for both
examples, including scoped-access checks, served-response verification, and token
revocation. The [run receipt](../../apps/oidc-broker/verification/idiomatic-deploy.json)
records the source revision and service configuration recovery before the successful retry.

**Video:** Pending — the live run is verified in GitHub Actions logs; no video has been recorded.

**Measured results:** [Live run receipt](../../apps/oidc-broker/verification/live.json)
— 24 seconds for this GitHub job, including setup and cleanup (one run, not a benchmark).
Follow the [proof-page contract](../PROOF-PAGES.md).

[GitHub Actions run 39880677228](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/39880677228)
verified a real GitHub OIDC exchange, a 15-minute **Individual Workers Editor** token,
this Worker's source read (200), the other example's source read (403), and R2 bucket
listing (403). Ordinary `wrangler deploy` published version `f1295d49-6a69-43e1-b37b-aa1454e87c25`;
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
node --test .github/actions/configure-cloudflare-credentials/client.test.mjs
pnpm --dir examples/oidc-wrangler build
```
