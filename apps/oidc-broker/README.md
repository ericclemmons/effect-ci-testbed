# Effect CI OIDC credential broker prototype

Keep execution in GitHub Actions and use a small Effect CI Worker to issue temporary
Cloudflare credentials. The examples are [Wrangler](../../examples/oidc-wrangler/README.md)
and [cf](../../examples/oidc-cf/README.md). This is a separate deployable trusted host;
it does not change the existing hosted runner or give build containers token-creation authority.

## One-time operator setup

This is the HITL boundary: deploying this service and granting it **Account API Tokens
Write** authority needs the account owner's approval. No such authority is configured
by checking in these files. Use a sandbox for the first hosted proof.

1. Install from the repository root (`pnpm install`). Bootstrap each example Worker
   using your existing operator credentials. Worker Editor permits updates, not creation.
2. Authorize the operator's `cf` OAuth session to provision account API tokens by
   re-running `cf auth login --force --scopes ...` with the existing requested scopes
   plus **`account_api_tokens:create`**. Approve the browser consent screen. The returned
   `offline_access` scope is represented by `offline` when requesting scopes from `cf`.
   A normal Workers login without token provisioning returns 403 on account-token APIs;
   that does not require manually creating an API token. See Cloudflare's
   [OAuth token-provisioning announcement](https://developers.cloudflare.com/changelog/post/2026-10-01-account-api-token-provisioning/).

   In the live account, this fixed the token API's 403 response, but OAuth still reported
   **Individual Workers Editor** and **Account API Tokens Write** as `is_selectable: false`.
   A dashboard-created issuer with only Account API Tokens Write could select Individual
   Workers Editor. OAuth provisioning access alone therefore did not bootstrap the issuer.
3. In Cloudflare's **Manage Account → Account API Tokens**, prepare a draft with
   **Specified Workers → exactly the example Worker → Editor**. Open **Review token →
   JSON Payload** and copy its `policies`. You do not need to click Create token.
   Repeat for the other Worker. Do not use legacy account-wide Workers Scripts Edit.
   The selector uses the Worker's immutable script tag, not its display name:

   ```json
   {
     "effect": "allow",
     "permission_groups": [{ "id": "7e79ec33834341f28dd431ab73884400" }],
     "resources": {
       "com.cloudflare.api.account.ACCOUNT_ID": {
         "com.cloudflare.edge.worker.script.WORKER_SCRIPT_TAG": "*"
       }
     }
   }
   ```

   [The live proof's grants](./verification/grants.json) show complete identity/policy
   entries. The operator's Workers script metadata API also returns each script's `tag`.
4. If you already have a single-Worker template token, you can instead export its
   policy with an operator API token that can read account token metadata:

   ```sh
   node scripts/create-grant.ts ACCOUNT_ID TEMPLATE_TOKEN_ID effect-ci-oidc-wrangler REPOSITORY_ID OWNER_ID \
     ericclemmons/effect-ci-testbed/.github/workflows/oidc-wrangler.yml@refs/heads/main
   ```

   Save its JSON output. Repeat for `effect-ci-oidc-cf` and `oidc-cf.yml`, then combine
   the two array entries. Obtain immutable repository/owner IDs from GitHub repository
   metadata. Change the owner/repository in `workflow_ref` for a fork. Inspect the
   copied resource policy to confirm it selects only the intended Worker, then revoke
   any disposable template tokens. This script makes a read-only API request and prints policies,
   not credential values. It deliberately does not invent the granular resource keys
   or permission IDs. The operator chooses the account, Worker and scope mapping.
   Alternatively, the authorized `cf` session can read token details with
   `cf accounts tokens get TOKEN_ID` (set `CLOUDFLARE_ACCOUNT_ID`), avoiding a separate
   operator API token. Token creation through `cf accounts tokens create` also supports
   OAuth, so the issuer and templates can be provisioned programmatically after consent.

5. Configure the broker environment using an ignored `.secrets.env` in this directory:

   ```dotenv
   BROKER_AUDIENCE=https://effect-ci-oidc-broker.YOUR_SUBDOMAIN.workers.dev
   BROKER_GRANTS='[{"repositoryId":"...","repositoryOwnerId":"...","ref":"refs/heads/main","workflowRef":"OWNER/REPO/.github/workflows/oidc-wrangler.yml@refs/heads/main","accountId":"...","worker":"effect-ci-oidc-wrangler","scopes":{"workers:edit":[COPY_EXACT_POLICY_OBJECT_HERE]}}]'
   CLOUDFLARE_TOKEN_ISSUER=YOUR_APPROVED_ACCOUNT_TOKEN_CREATION_CREDENTIAL
   RECEIPT_SIGNING_KEY=AT_LEAST_32_RANDOM_CHARACTERS
   ```

   Replace the illustrative grants value with the complete generated JSON array.
   Generate the receipt key with `openssl rand -hex 32`. The issuer credential needs
   **Account API Tokens Write** for the selected account; this is broader authority
   than the issued deployment token. Never grant its permissions to the job's scopes.
   Treat this Worker as an administrative service. Do not log these values.
6. Once authorized, deploy with `pnpm exec cf deploy --secrets-file .secrets.env`.
   Set GitHub repository variable `EFFECT_CI_OIDC_BROKER_URL` to the same HTTPS origin.
   Copy either example workflow into the repository root as documented there.

Cloudflare references: [Worker granular authorization](https://developers.cloudflare.com/workers/authorization/),
[account token creation](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/create/),
and [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc).

## Request and scope model

`POST /token`, authenticated with a GitHub OIDC JWT whose audience is the broker origin:

```json
{ "worker": "effect-ci-oidc-wrangler", "scopes": ["workers:edit"] }
```

No named profile is required. A grant binds immutable repository/owner IDs, exact branch,
exact workflow ref and Worker to an allowed scope map. The broker unions only the policies
for the scopes actually requested. Unknown scopes, other Workers and PR events are rejected.
Scope names are operator-defined: add `r2:read` only if it maps to an explicitly approved
Cloudflare policy, and request it only when necessary. The action cannot supply arbitrary
Cloudflare policies, account IDs or token lifetimes. Resource specificity depends on the
product's Cloudflare authorization support, not the Effect CI scope's label.

GitHub signatures are verified against its cached JWKS, with RS256 only, exact issuer/audience,
expiry and a ten-minute maximum identity age. Each JWT ID can be exchanged once, persisted
in a Durable Object before issuance. Issuance failures are not automatically retried. The
account-owned token expires after 15 minutes. A signed receipt authorizes only revocation
of that lease, so post-job cleanup needs no second OIDC request. The DO never stores the
token value; it retains the token ID until cleanup, and clears bookkeeping after 20 minutes.
Broker and action errors do not reflect upstream response bodies or credentials.

The broker must accept OIDC-authenticated requests directly; do not add an Access service-token
requirement that would reintroduce a GitHub secret. The existing Effect CI service's human
Access policies stay independent. A future integration can mount this handler in that host.

## Local validation and remaining proof

```sh
pnpm test
pnpm check
pnpm build
node --test ../../.github/actions/cloudflare-auth/client.test.mjs
```

No hosted issuance/deploy/revocation has been verified. The first live proof must confirm
Cloudflare accepts the copied granular policy, both CLIs deploy with only that policy,
another Worker's mutation and R2 access are denied, and cleanup revokes the token.
Do not silently broaden scopes if a CLI asks for additional permissions. Account token
limits, durable audit history and per-identity rate limiting remain follow-up work.
Expiry is the fallback for runner loss or an ambiguous API response. This prototype
does not refresh tokens during deployments longer than 15 minutes.
