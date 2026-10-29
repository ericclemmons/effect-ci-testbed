# Self-host Effect CI

Give this guide to your agent on each machine. Retire the old host, deploy in the
new Cloudflare account, then prove it with a new app. Self-hosting here means
hosting in **your Cloudflare account**, not running a server on your laptop.

Local execution needs no hosted account, GitHub App, Access login, or OIDC.
`--remote`, GitHub-triggered runs, and cloud deployment need their respective setup.
GitHub App ownership and Cloudflare hosting/billing are separate.

## Instructions for the agent

- Confirm the source account, destination account, approved budget, host name,
  GitHub App choice, and approved secret provider. Access is not spending authority
  or permission to copy personal credentials into a work vault.
- Check `cf --version`; discover resource commands with `cf cli search` and the
  selected command's `--help`. Never include identifiers in discovery searches.
- Never print secrets, credential files, private keys, or resolved environment
  values. Record resource IDs and verification results instead.
- Inventory is read-only. Ask before provisioning, changing App settings, deleting
  an exact resource list, or changing subscriptions. Do not replace default logins.

The order below supports **teardown first**, with downtime and no old-host
rollback. For a no-downtime move, deploy and prove the replacement first, switch
the webhook, then tear down. Preserve required credentials and history either way.

## 1. Old machine: preserve what you need, then tear down

1. Select a named `cf` profile for the old account; confirm identity and account
   ID. Check whether inherited `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID`
   overrides that selection. Report presence, not values. Do not log out globally.
2. Inventory deployed Workers, Workflows/active runs, containers/images, Durable
   Object storage, Access applications/service tokens, routes, DNS, and referenced
   services/storage. Include separate docs/demo/runner services only when owned by
   this teardown. A name prefix is not proof of ownership. Note state-loss risks.
3. Save required history, the inventory, App ID/settings, and webhook URL privately.
   Transfer necessary credentials through the approved password manager, never
   chat, email, Git, or a copied credential directory. See the transfer table below.
4. With approval, stop new dispatches and drain or explicitly cancel active runs.
   Present the exact account/resource IDs, dependency order, and state loss; wait
   for approval of that deletion list. Do not delete or recreate the GitHub App.
5. Delete only approved resources with the installed `cf` commands. Stop on shared
   bindings rather than forcing deletion. Re-list resources and report leftovers.
6. Check subscriptions and outstanding usage separately. Deleting resources does
   not cancel paid plans. Obtain separate approval for
   [subscription cancellation](https://developers.cloudflare.com/billing/manage/cancel-subscription/).

Use configuration to identify candidates, not as an automatic deletion list:

[Host configuration](./cloudflare.config.ts)

## 2. Work machine: deploy an independent host

1. Confirm the approved destination account and spending limit. Use a separate
   checkout/worktree with Node 24.11+, pnpm 12.8.1, and the container build
   prerequisites required by `cf`. Run `pnpm install --frozen-lockfile`.
2. Use the project's CLI, not an assumed global installation. From the checkout
   root, enter the host project and bind the profile to the checkout root:

   ```sh
   cd apps/effect-ci
   pnpm exec cf --version
   pnpm exec cf auth create effect-ci-work --no-browser
   pnpm exec cf auth activate effect-ci-work ../..
   pnpm exec cf auth whoami
   ```

   Use the intended identity for authorization. Reuse an existing profile rather
   than reauthenticating it without approval. Profiles do not pin the account:
   verify the explicit destination account ID before every cloud write. If this
   version lacks named profiles, stop and select an approved compatible CLI;
   do not fall back to replacing the default login.
3. Still in `apps/effect-ci`, run the existing one-time bootstrap:

   ```sh
   pnpm run setup --account <approved-account-id> --subdomain <workers-dev-subdomain>
   ```

   This writes ignored `.env.production`, generates an API token, and creates a
   cloud Access service token. It is not a preview. An existing file for another
   account requires a separate checkout, not overwriting. Keep
   `EFFECT_CI_PROFILE=standalone`, an independent Worker name, and project root `.`
   unless a nested project is intended. Do not use the backward-compatible `demo`
   default.
4. Follow [GitHub App and credential transfer](#github-app-and-credential-transfer)
   and [environment and secret management](./SELF-HOST-ENV.md). Use
   `.env.production`, not `.deploy.env`. Do not rerun bootstrap after replacing
   values with provider references: bootstrap does not resolve those references.
5. After installing/configuring Varlock and the selected provider as described in
   the environment guide, resolve credentials before calling the deploy code:

   ```sh
   APP_ENV=production varlock run --inject vars -- pnpm exec node scripts/deploy.ts --dry-run
   APP_ENV=production varlock run --inject vars -- pnpm exec node scripts/deploy.ts
   ```

   The dry run packages/builds local artifacts. Deployment configures Access
   first, then uploads allowlisted secrets and deploys. Temporary secret files are
   cleaned on exit, but failed deployments do not roll back Access changes.
6. Confirm resources are in the new account. Anonymous `/` must redirect to
   Access; unsigned `/webhooks/github` must return `401`; unauthenticated
   `POST /runs` must start no work. Check readiness after authentication. With
   approval, point the App webhook at the new origin plus `/webhooks/github`.

**Current command boundary:** bare `cf deploy` does not configure Access, package
the standalone CLI runtime, or select/upload host secrets. Host bootstrap still
uses the existing scripts above. Ordinary application projects can use `cf deploy`
as described below. This documentation does not implement native host deployment
or automatically install Varlock.

## GitHub App and credential transfer

| Item | Existing App, new host | New App |
| --- | --- | --- |
| App ID | Keep | Record new ID |
| Private PEM key | Retrieve securely, or generate another key for this App | Generate and store securely |
| Webhook secret | Keep during host-only cutover; both ends must match | Generate a high-entropy secret |
| Installations | Keep selected repositories | Install on selected repositories |
| Webhook URL | Change at cutover | New origin plus `/webhooks/github` |
| Host API token and Access credentials | Generate for new host/account | Generate for new host/account |
| OIDC issuer credential and receipt key | Generate for destination; re-enroll repositories | Generate for destination |

For a new App, use GitHub **Settings → Developer settings → GitHub Apps**. Set the
homepage to the host origin and enable webhook SSL verification. Grant **Checks:
read/write** and **Contents: read**; subscribe to **Check suite** events. Subscribe
to **Push** only for deliberately enabled branch-sensitive routing. Basic CI
needs no repair/write or approval capabilities.

Store `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` (original multiline PEM), and
`GITHUB_WEBHOOK_SECRET` in the approved provider. `EFFECT_CI_API_TOKEN` is a separate
secret. Never put App credentials in tutorial apps, GitHub Actions, or containers.

An App has one configured webhook URL; changing it affects all installations.
Confirm which repositories move. Keep the old key/settings until the replacement
is proven; revoke obsolete keys only with approval.

[GitHub App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
and [settings changes](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration).

## 3. Prove it with a new app

1. Follow the [tutorial's local app and CLI setup](../../examples/demo/README.md)
   in a new disposable repository. Run its normal local checks and
   `effect-ci run --local` **before configuring a host**. Local execution must not
   depend on cloud credentials or contact the hosted runner.
2. Put public `EFFECT_CI_REMOTE_URL=https://<new-host>` in the app's committed
   `.env`. It is configuration, not a secret. The CLI already loads `.env` and
   ignored `.env.local`; no GitHub variable or secret is needed for the URL.
3. With approval, create/push the GitHub repository and install the chosen App.
   Configure the host's run identity as described below. From the clean, pushed
   checkout, authenticate with `cloudflared access login https://<new-host>`, then
   run `effect-ci oidc`. For Access-only enrollment, first configure the host's
   Access issuer and audience; otherwise also inject its API token privately as
   `EFFECT_CI_REMOTE_TOKEN`. Enrollment does not read the private remote profile.
   Commit generated `.cloudflare/ci/oidc.json`; it contains no credentials.
4. Run `effect-ci run test build --remote`. Human Access-only authentication needs
   host `EFFECT_CI_ACCESS_ISSUER` and `EFFECT_CI_ACCESS_AUD` configured. Otherwise,
   provide the host API token privately as well as Access authentication. Use
   provider injection or a private user-owned remote profile, never committed
   configuration; see [environment management](./SELF-HOST-ENV.md).
5. Push a harmless app change. Verify App delivery, GitHub checks, the Workflow
   result, and the requested commit in the **new account**. Record run ID, commit
   SHA, account ID, and pass/fail results. A ready page or dry run is not proof of
   repository execution. Inspect an existing run ID after a stream disconnect
   rather than dispatching another run.

## 4. Enable OIDC for hosted runs and application deployment

Use the shared host's OIDC support, not the legacy separate runner broker.

| Capability | Host configuration |
| --- | --- |
| Repository enrollment and hosted run identity | `EFFECT_CI_PUBLIC_URL`, `RECEIPT_SIGNING_KEY`, `EFFECT_CI_OIDC_OWNER_IDS` (approved numeric GitHub owner IDs), App installation, repository enrollment |
| Short-lived Cloudflare deployment credentials | Also destination `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_TOKEN_ISSUER` authorized to issue account tokens, and approved policy JSON in `EFFECT_CI_OIDC_SCOPES` |

Have the account administrator approve actual permission groups/resources. Do not
copy personal-account policy IDs. The shared-host grant covers enrolled
repositories under allowed owners across refs/workflows. Account-scoped Workers
write permits creating Workers and is broader than updating one Worker. Stop if
that scope is not approved; do not claim the legacy broker's tighter restrictions.

1. Store approved host values in its provider, redeploy, and enroll the new app.
   Verify wrong owners, unenrolled repositories, and unapproved scopes are denied
   without starting work or leaking credentials.
2. In GitHub Actions, commit `permissions: id-token: write` with the required
   checkout permission and install the CLI in the job. Keep the host in `.env`
   and commit enrollment configuration. No operator Cloudflare token, Access
   service token, or password-manager credential belongs in the application job.
3. Use `effect-ci run --remote` for hosted execution. For deployment from an
   authenticated workload, use the **currently implemented**
   `effect-ci oidc -- cf deploy` in the application's configured directory. The
   child receives a short-lived token; the wrapper revokes it on exit. Report
   revocation failure; expiry is also limited to 15 minutes. Plain `cf deploy`
   does not acquire an OIDC credential by itself.
4. Prove a real deployment and served response in the new account, then verify
   cleanup. Record local, remote, webhook, and OIDC deployment results separately.
   Optional Slack, repair, and release integrations are not prerequisites.

[CLI OIDC implementation](../../packages/cli/src/oidc.ts)

## Completion record

Return public host/repository links, commit/run IDs, verification results, deleted
and remaining resource IDs, and separate billing status. List blocked/unverified
steps. Never include credentials. This procedure is not evidence that a
fresh-account cutover has passed.
