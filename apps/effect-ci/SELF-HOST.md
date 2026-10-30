# Self-host Effect CI

Deploy the current host, including its GitHub Actions runner, previews, Slack
reviews and repair services. Repositories and the GitHub App can stay where they
are; configure their callbacks to use your host.

The current configuration calls this complete setup `EFFECT_CI_PROFILE=demo`.
Use it below. `standalone` is an earlier reduced entrypoint that omits these
service connections; it is not the setup demonstrated by this repository.

## Give this to your agent

<textarea aria-label="Self-hosting agent prompt" rows="7" readonly spellcheck="false">
Follow this guide: https://effect-ci-docs.eclemmons.workers.dev/apps/effect-ci/self-host/
Help me deploy the complete Effect CI host and its connected services in my Cloudflare account.
Use the existing configuration files and cf commands; do not extract or replace the integrations.
Ask me for the account ID, workers.dev subdomain, and GitHub App owner.
Keep credentials in a secret manager or private local files, never Git or chat.
Reuse my GitHub App and repositories when replacing a host. Verify each flow before switching callbacks.
Only tear down an existing host if I ask. Confirm destructive changes and paid inference budgets.
Finish by following the walkthrough against my host.
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

1. Authenticate with a named profile and verify the account:

   ```sh
   cf auth create effect-ci --no-browser
   cf auth whoami --profile effect-ci
   export CLOUDFLARE_ACCOUNT_ID=<account-id>
   cd apps/effect-ci
   cp .env.production.example .env.production
   ```

   Unset an inherited `CLOUDFLARE_API_TOKEN` before authentication. Use the profile
   explicitly on later `cf` commands, or activate it with `cf auth activate effect-ci`.
2. Find the account's `workers.dev` subdomain in **Workers & Pages**. Fill in
   `.env.production`, using
   `https://effect-ci-github-cloudflare.<workers-dev-subdomain>.workers.dev` as the host.
   Keep the existing Worker names: the connected services refer to them by name.

   [Production settings](./.env.production.example "source")

## Configure the GitHub App

1. Open [GitHub App settings](https://github.com/settings/apps). Reuse your existing
   App and installations when replacing a host. Preserve its permissions and event
   subscriptions. If its key is unavailable, generate a new key on the same App;
   keep the existing key valid until cutover.
2. For a new App, use **New GitHub App**. Set the homepage to your host and webhook
   to `<host>/webhooks/github`. Keep SSL verification enabled. Store a random
   webhook secret securely. Leave **Active** off until the host is deployed.
3. Grant **Contents: read**, **Checks: write**, **Administration: write** and
   **Actions: read** for CI and the hosted runner. Subscribe to **Check suite**,
   **Push** and **Workflow job**. Repair/PR-writing flows also need their owning
   writer's documented permissions; review those before enabling writers.
4. Save the App ID and downloaded PEM securely. Install the App on the repositories
   it will run. Configure the runner's App, installation and repository IDs in
   its [enrollment](../github-actions-runner/src/enrollment.ts "source").
   An App installation alone does not enroll a runner or grant repair authority.

[GitHub App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)

## Configure Access

1. Open **Cloudflare Zero Trust**, configure a login method and save the team URL
   as `EFFECT_CI_ACCESS_ISSUER`.
2. Copy `access/{service,webhook,token,revoke,api}.example.json` to the matching
   `.json` files. Replace their hostname with your host and the service policy's
   email with your operator email. Create the four path exceptions before the
   hostname policy:

   ```sh
   cf zero-trust access applications create --body "$(cat access/webhook.json)"
   cf zero-trust access applications create --body "$(cat access/token.json)"
   cf zero-trust access applications create --body "$(cat access/revoke.json)"
   cf zero-trust access applications create --body "$(cat access/api.json)"
   cf zero-trust access applications create --body "$(cat access/service.json)"
   ```

   Save the returned IDs and the service application's `aud`. Set
   `EFFECT_CI_ACCESS_AUD`. Add a narrow bypass for `/webhooks/slack` too; Slack
   requests still require signature verification. Update existing applications
   by ID instead of creating duplicates.
3. Update the host origin, issuer, audience and intended operator's Access subject
   digest in the current [operator policy](./src/demo-access-policy.ts "source").
   Match the subject to the intended human through an authenticated Access session
   or the Access user API. Do not print the session JWT. These source-owned pins
   currently need updating as well as the environment settings.
4. Inspect `cf zero-trust organization get`. If `deny_unmatched_requests` is true,
   preserve it and create explicit public applications for docs, previews,
   the release target and the signed notification receiver. Replace the subdomain
   in each request and create one application object at a time. Private service
   bindings need no public bypass. Add applications for deployed walkthrough apps
   too. Keep the incident trigger private until its readiness checks pass.

   [Public endpoint Access requests](./access-public.example.json "source")

## Configure the connected services

These are parts of the current host. They have separate deployment directories
because the implementation currently uses several Workers. Deploy them in the
same account so their service bindings resolve.

| Service | Setup and credentials |
| --- | --- |
| [Actions runner](../github-actions-runner/README.md) | Full runner mode; enrolled App/installation/repository; `RUNNER_APP_PRIVATE_KEY` and `RUNNER_WEBHOOK_SECRET`. |
| [Preview publisher](../../test/apps/demo-site/README.md) | Immutable storage and `DemoSitePublisher` export. Set `demoSiteOrigin` in `packages/cloudflare/src/demo-site.ts` to its URL. |
| [Release manager](../../test/apps/release-manager/README.md) | Set `RELEASE_ACCOUNT`; create `HMD_DEPLOY_TOKEN` scoped to the release target. |
| [Release target](../../test/apps/hmd-demo/README.md) | Deploy a healthy baseline. Upload healthy/regression candidates; update HMD controller, review and diagnostic version pins. Keep baseline traffic at 100% during setup. |
| [Repair AI](../../test/apps/repair-ai/README.md) | Workers AI binding and an explicitly approved inference budget. Preserve the budget ledger across deployments. |
| [Repair agent](../../test/apps/repair-agent/README.md) | Generated Flue exports and bindings to repair AI/events. |
| [Repair events](../../test/apps/repair-events/README.md) | Shared notification secret; Notifications destination/policy, Issues automation and exact source/version enrollment. |
| [Incident source](../../test/apps/repair-incident/README.md) | Readiness binding to the main host; fixed-service Issues configuration. [Arming prepares one later fixture test](./PUBLIC-REPAIR.md#what-arming-means); it does not emit an incident or call AI. The persistent arm has no reset API and needs explicit approval. |
| [Documentation](../docs/README.md) | Public static site. The Documentation GitHub workflow publishes a completed main-check snapshot using the existing OIDC broker. Disable any independent push-triggered docs deployment. |

The current release/repair policies contain repository, identity and version pins.
Review their owning configuration before enabling them for another installation;
do not copy historical run receipts as fresh enrollment. Other example/proof
Workers are independent fixtures and are not prerequisites for the host.

## Store credentials

1. Follow [the credential setup](./SELF-HOST-ENV.md). Keep each service's credentials
   on its owning Worker. The main host needs the GitHub App credentials, API token,
   signing key, Access settings and allowed numeric GitHub owner IDs.
2. Configure Slack using the existing App: `SLACK_BOT_TOKEN`,
   `SLACK_SIGNING_SECRET`, `SLACK_APP_ID`, `SLACK_TEAM_ID`, `SLACK_CHANNEL_ID` and
   `SLACK_APPROVER_IDS`. Set `EFFECT_CI_DETAILS_URL` to this account's Workflow URL.
   Add these values to the private environment file; the committed schema and
   secret manifest list their bindings.
3. For this repository's automatic main deployment, configure a deployment token
   with the required Workers/container permissions as `CLOUDFLARE_API_TOKEN`.
   It stays on the host; project containers receive the deployment proxy's dummy
   credential. App deployment uses the separate short-lived issuer below.
4. If a secret manager is unavailable, use an owner-only local secrets manifest
   outside Git and pass it to `cf deploy --secrets-file <private-file>`.
   Generate replacement credentials or use an encrypted transfer; do not use a
   public paste service. Never print credential values in chat or command output.

## Deploy

1. Deploy the runner, preview publisher, healthy release target, release manager
   and repair AI from their owning directories, following the linked instructions.
   Supply only each service's credential manifest.
2. Bootstrap the repair binding cycle with
   `test/apps/repair-events/src/public-enrollment.ts` set to `undefined`, which
   omits its bindings to the not-yet-created host and incident source. Deploy
   the receiver with its secret, then generate/build and deploy the repair agent.
3. From `apps/effect-ci`, validate and deploy the main host:

   ```sh
   pnpm exec varlock load --agent
   pnpm exec varlock run --inject vars -- cf deploy --secrets-file secrets.env --dry-run
   pnpm exec varlock run --inject vars -- cf deploy --secrets-file secrets.env
   cf workers get effect-ci-github-cloudflare
   cf workflows list
   cf containers applications list
   ```

   Verify its declared service bindings, Workflows and containers. Then deploy
   the incident source, whose readiness binding can now resolve the host.
4. Configure Notifications/Issues and enroll the exact deployed source/version
   using the receiver's [setup instructions](../../test/apps/repair-events/REPRODUCE.md).
   Restore its enrollment and redeploy after verifying those IDs. Keep the public
   incident trigger blocked until readiness and arming have been approved.
5. Deploy docs separately and enable its Documentation GitHub workflow after
   configuring `EFFECT_CI_REMOTE_URL` and repository OIDC enrollment. Its publisher
   waits for completed main checks, then uses the existing Cloudflare authentication
   action. Disable any independent Workers Builds push trigger so it cannot publish
   incomplete checks. When changing accounts, update the broker and deployment
   account. Stored Workflow history, assets, release
   journals, cached checks and inference budgets do not move with source code.

## Connect and verify

1. Open `<host>/capabilities` and sign in through Access. Verify operator access.
2. Set the GitHub App's homepage and webhook to your host and enable deliveries.
   Verify a signed `ping` returns `2xx`. In the [Slack App website](https://api.slack.com/apps),
   open **Interactivity & Shortcuts**, set **Request URL** to
   `<host>/webhooks/slack`, and save.
3. Set the repository variable `EFFECT_CI_REMOTE_URL` to your host. Push a branch
   change and verify native Workflow completion, per-action GitHub checks and
   container cleanup. Run an enrolled runner smoke job and verify its native
   GitHub logs and subsequent runner deregistration.
4. Follow the walkthrough below. Verify an app deployment through OIDC, immutable
   preview publication, a real Slack review button and staged-release restoration.
   Verify repair capture/admission/proposal separately within the approved budget.
   Record each result; a green CI push alone does not establish every integration.
5. When replacing a host, put its updated account/origin settings on the deployment
   branch before relying on automatic deployment. Verify main's self-deployment
   and the separate docs build before removing the previous resources.

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
steps after verifying its replacement. Save the resource inventory, configuration and credential references before
deleting anything. Include supporting Workers, Notifications policies, Issues
automations and Workers Builds triggers. Disable their triggers before removal.
Remote CI is unavailable between teardown and replacement.

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
