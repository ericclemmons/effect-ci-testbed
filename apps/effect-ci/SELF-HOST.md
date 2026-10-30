# Self-host Effect CI

This prototype runs locally without a Cloudflare account. To try `--remote` and
GitHub checks, deploy a host in a Cloudflare account you control.

**Moving the existing hosted setup to another account?** Follow
[Move the existing hosted apps](./MIGRATE.md). Your repositories stay on GitHub.
That path preserves this repository's CI, hosted Actions runner, preview/release
services and Slack integration. The new-host instructions below select
`EFFECT_CI_PROFILE=standalone`: a smaller installation with a different CI
entrypoint, not a copy of the existing hosted setup.

## Give this to your agent

<textarea aria-label="Self-hosting agent prompt" rows="7" readonly spellcheck="false">
Follow this guide: https://effect-ci-docs.ericclemmons.workers.dev/apps/effect-ci/self-host/
Help me deploy an Effect CI host in my Cloudflare account.
If replacing the existing hosted setup, follow the linked migration guide and preserve its features.
Use the guide's cf commands and configuration files, not custom setup/deploy scripts.
Ask me for the account ID, host name, and GitHub App owner.
Use 1Password for credentials; never print secret values or put them in Git.
Only tear down an existing host if I ask. Confirm resource IDs and paid-plan changes with me.
Finish by following the linked walkthrough against the new host.
</textarea>

## Install the tools

1. Install Node 24.11+ and pnpm 12.8.1. Install [CF CLI globally](https://developers.cloudflare.com/cf/get-started/#install-cf):

   ```sh
   npm install --global cf
   cf --version
   ```

2. Clone this repository into your working directory and install its locked dependencies:

   ```sh
   git clone https://github.com/ericclemmons/effect-ci-testbed.git
   cd effect-ci-testbed
   pnpm install --frozen-lockfile
   ```

   `cf` uses the project's pinned version when run inside it. This guide requires
   `1.0.0-beta.24` or later for environment expansion in the secrets manifest.
   Install and start [Docker](https://docs.docker.com/get-started/get-docker/) for container builds.

## Choose the account

1. From the checkout root, create and select a profile:

   ```sh
   cf auth create effect-ci --no-browser
   cf auth activate effect-ci
   cf auth whoami
   export CLOUDFLARE_ACCOUNT_ID=<account-id>
   cd apps/effect-ci
   ```

   Use an existing profile instead if you have one. Unset an inherited
   `CLOUDFLARE_API_TOKEN` first. Approve only the intended account's paid services.
2. In Cloudflare **Workers & Pages**, find the account's `workers.dev` subdomain.
   Use `effect-ci.<subdomain>.workers.dev` as the new host.
3. Copy the production settings file and replace every placeholder:

   ```sh
   cp .env.production.example .env.production
   ```

   [`.env.production` contents](./.env.production.example "source")

## Create the GitHub App

1. Open the owning account's **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Enter a unique **GitHub App name** and **Homepage URL** `https://effect-ci.<subdomain>.workers.dev`.
   Leave user callback and setup URLs empty.
3. Under **Webhook**, enter `https://effect-ci.<subdomain>.workers.dev/webhooks/github`.
   Generate a 64-character random secret in 1Password, save it as `GITHUB_WEBHOOK_SECRET`,
   and paste it into **Secret**. Keep SSL verification enabled; leave **Active** off until deployment.
4. Under **Repository permissions**, set **Checks: Read and write** and **Contents: Read-only**.
   Under **Subscribe to events**, select **Check suite**. Leave other optional permissions/events off.
   Select **Only on this account**, then **Create GitHub App**.
5. Copy the numeric **App ID** into `.env.production` as `GITHUB_APP_ID`.
   Open **Credentials → Key pairs → New key**. Store the downloaded PEM's complete
   contents in 1Password as `GITHUB_PRIVATE_KEY`, including its header, footer, and newlines.
6. Select **Install App → Install → Only select repositories** and choose the repositories this host will run.

[GitHub registration instructions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
· [Private-key instructions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)

**Reusing the existing App instead:** keep its App ID, key, secret, and installations.
Retrieve the key/secret from 1Password. Change its homepage and webhook
to the new host; enable **Active** after deployment. This moves all of that App's installations.
If changing machines, authenticate with CF CLI rather than copying `~/.config/cloudflare` or Cloudflare tokens.

## Configure Access

1. Open Cloudflare **Zero Trust** in your account. Complete organization
   setup if prompted. Enable an [Access login method](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
   and copy the team domain into `.env.production` as `EFFECT_CI_ACCESS_ISSUER`, including `https://`.
2. Copy the five Access request files:

   ```sh
   cp access/service.example.json access/service.json
   cp access/webhook.example.json access/webhook.json
   cp access/token.example.json access/token.json
   cp access/revoke.example.json access/revoke.json
   cp access/api.example.json access/api.json
   ```

   Replace `<workers-dev-subdomain>` in each file and `<your-email>` in `service.json`.
   [Service request](./access/service.example.json "source")
3. Create the path exceptions first, then protect the hostname:

   ```sh
   cf zero-trust access applications create --body "$(cat access/webhook.json)"
   cf zero-trust access applications create --body "$(cat access/token.json)"
   cf zero-trust access applications create --body "$(cat access/revoke.json)"
   cf zero-trust access applications create --body "$(cat access/api.json)"
   cf zero-trust access applications create --body "$(cat access/service.json)"
   ```

   Save each returned `id`. Copy the last response's `aud` into `.env.production` as
   `EFFECT_CI_ACCESS_AUD`. On later changes, use
   `cf zero-trust access applications update <app-id> --body "$(cat access/service.json)"`
   for the corresponding file, rather than creating duplicates.

## Store credentials and deploy

1. Follow [the file and 1Password setup](./SELF-HOST-ENV.md). Get your GitHub owner's
   numeric ID from `https://api.github.com/users/<owner>` and put it in
   `EFFECT_CI_OIDC_OWNER_IDS`. An organization also has a numeric `id` at that endpoint.
2. Validate and preview the deployment:

   ```sh
   pnpm exec varlock load --agent
   pnpm exec varlock run --inject vars -- cf deploy --secrets-file secrets.env --dry-run
   ```

3. Deploy:

   ```sh
   pnpm exec varlock run --inject vars -- cf deploy --secrets-file secrets.env
   cf workers get effect-ci
   cf workflows list
   cf containers applications list
   ```

   Use your configured Worker name if you changed it. Vite packages the CLI runtime
   during the build. No setup/deploy script or `APP_ENV` variable is needed.
4. Open the host URL. Access must show its login screen; sign in with the email
   in `access/service.json`. In the GitHub App settings, enable **Webhook → Active**.
   Under **Advanced → Recent Deliveries**, open the `ping` delivery and check for a `2xx` response.

## Connect your app

Use the [walkthrough](../../examples/demo/README.md) to create and run a new app
locally. Before its **Run on a host** commands:

1. From your app's clean, pushed checkout, put `EFFECT_CI_REMOTE_URL=https://<new-host>`
   in its committed `.env`. In the GitHub App's **Install App → Configure**, add
   this repository to **Repository access** and save. Install
   [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Register the repository with this host (called enrollment). This lets the host
   authenticate remote CLI and deployment requests. It does not move the GitHub
   repository. A new host has its own registration records, so repeat this even
   when the old host already knew the repository:

   ```sh
   cloudflared access login https://<new-host>
   effect-ci oidc
   git add .env .cloudflare/ci/oidc.json
   git commit -m "Configure hosted CI"
   git push
   ```

3. Resume **Run on a host** in the walkthrough.

## Enable short-lived deployment credentials

Skip this section if the host will only run tests/builds, not deploy applications.

1. In your Cloudflare account, open **Manage account → Account API tokens → Create Token**.
   Name it `Effect CI token issuer`; grant **Account → Account API Tokens → Edit** for this account only.
   Create the token and save it in 1Password as `CLOUDFLARE_TOKEN_ISSUER`.
   This requires Super Administrator or API Token Provisioning access.
   [Cloudflare's token-issuer setup](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/).
2. Find the account's Workers permission group:

   ```sh
   cf accounts tokens permission-groups list --name Workers%20Scripts%20Write
   ```

   Copy its selectable `id`. Replace both placeholders in
   [the scope policy](./oidc-scopes.example.json "source"). This policy permits
   creating/updating Workers throughout the configured account, not just one Worker.
3. In `.env.production`, add `CLOUDFLARE_TOKEN_ISSUER=op(op://effect-ci-production/host/CLOUDFLARE_TOKEN_ISSUER)`.
   Add `EFFECT_CI_OIDC_SCOPES='...'` with the completed policy JSON on one line.
   Run the deploy command again.
4. For deployment from a hosted workflow, run `effect-ci oidc -- cf deploy` in the
   app directory. For GitHub Actions, give the job `id-token: write` and `contents: read`
   and install the CLI. The wrapper requests a 15-minute Cloudflare token and revokes
   it when the command exits. Keep the host URL in `.env`, not a CI secret.

## Optional: tear down an existing host

Skip this section for a first deployment. If replacing a host, you can run these
steps after verifying its replacement. For a lower-cost migration with downtime,
save the resource inventory, configuration and credential references from
[the migration guide](./MIGRATE.md) before deleting anything. Remote CI will be
unavailable until the replacement passes verification.

Deleting the host removes its stored state and stops remote CI. Local runs still work.

1. In the existing checkout, select the host's profile and account:

   ```sh
   cf auth list
   cf auth activate <profile-name>
   cf auth whoami
   export CLOUDFLARE_ACCOUNT_ID=<existing-host-account-id>
   ```

   If `CLOUDFLARE_API_TOKEN` is set, unset it before selecting a profile;
   API tokens override profiles.
2. If the App still points at the old host, clear **Webhook → Active** in
   [GitHub App settings](https://github.com/settings/apps). If it already points
   at the verified replacement, leave it active. Keep its key and webhook secret
   in 1Password if reusing it.
3. List the host's resources and active runs:

   ```sh
   cf workers list
   cf workflows list
   cf workflows instances list --workflow-name <workflow-name> --status running
   cf workflows instances list --workflow-name <workflow-name> --status queued
   cf containers applications list
   cf containers images list
   cf zero-trust access applications list
   cf zero-trust access service-tokens list
   ```

4. Wait for active runs to finish, or terminate each unwanted run:

   ```sh
   cf workflows instances terminate <instance-id> --workflow-name <workflow-name> --status terminate
   ```

5. Confirm the IDs belong to this host. Delete its Workflow, container application,
   Worker, unused container image tags, and Access applications. Repeat only for resources you own:

   ```sh
   cf workflows delete <workflow-name>
   cf containers applications delete <container-application-id>
   cf workers delete <worker-name>
   cf containers images delete <image:tag>
   cf zero-trust access applications delete <access-application-id>
   cf zero-trust access service-tokens delete <unused-service-token-id>
   ```

   Do not add `--delete-with-references` to force Worker deletion.
6. Run the list commands again. In Cloudflare **Billing → Subscriptions**, review
   and [cancel unwanted subscriptions](https://developers.cloudflare.com/billing/manage/cancel-subscription/)
   separately. Resource deletion does not cancel a paid plan.
