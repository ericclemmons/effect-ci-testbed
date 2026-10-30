# Move the existing hosted apps

Move Cloudflare execution and billing to another account while keeping the same
GitHub repositories, GitHub App and CI behavior. This is the existing testbed's
account migration, not the smaller new-host installation.

## What must stay the same

The current configuration has two choices:

| Configuration | What it runs |
| --- | --- |
| `EFFECT_CI_PROFILE=standalone` | A generic CI host. It checks out a repository and runs its workflow inside the workspace container. |
| `EFFECT_CI_PROFILE=demo` | The existing host. It runs this testbed's CI directly, forwards hosted Actions jobs, and connects preview, release, Slack and repair services. |

Use `demo` for this migration. Keep the existing Worker names: service bindings
refer to those names within the destination account. The GitHub App installation
IDs and repository URLs remain unchanged when the same App is reused.

[Host configuration](./cloudflare.config.ts "source")

[Existing CI entrypoint](./src/monorepo-workflow.ts "source")

Baseline: landed `demo` configuration at `fb0cf6d`. These are existing calls; moving their
Cloudflare resources changes their account, not their function signatures. The
destination deployment and live acceptance remain work to perform:

```diff
 GitHub App → worker.fetch(request, environment, context)
   runnerWebhook(request, environment)
     GITHUB_ACTIONS_RUNNER.fetch(request)
   monorepoGitHubRun(identity, environment, context)
     MonorepoCIWorkflow.run(event, step)
       repository workflow → checkout / install / check / test / build
       main → deployment proxy → deploy runner, then CI host
       finally → WorkspaceContainer.stop() for every workspace
- Cloudflare resources, bindings and deployment authority: personal account
+ Cloudflare resources, bindings and deployment authority: work account
```

The CI host owns webhook authentication and routing. The runner owns job admission,
one-job registration, container destruction and deregistration. A failed CI run
still cleans up its workspaces; failed runner cleanup must be reconciled before
removing its stored journal.

## Inventory the source account

Use the existing account's CF authentication profile. Keep the inventory private;
retain configuration, binding names, secret **names** and 1Password references,
not secret values in an agent transcript. Workers cannot provide secret values
back: recover them from their original credential store.

```sh
cf auth whoami
cf workers list
cf workflows list
cf containers applications list
cf containers images list
cf zero-trust access applications list
cf zero-trust access service-tokens list
```

Record active runs, Notifications destinations/policies, Issues automations,
Workers Builds triggers and any custom domains too. List commands alone do not
capture those resources or their settings. This table is the source dependency
map, not proof of what is currently deployed:

| Worker / source directory | Required connections or configuration |
| --- | --- |
| `effect-ci-github-cloudflare` / `apps/effect-ci` | `demo` profile; the five service targets below; GitHub, Access, OIDC and Slack settings; account-scoped main CD credential. |
| `effect-ci-github-actions-runner` / `apps/github-actions-runner` | Existing App/installation/repository enrollment; App key and webhook secret; full runner, not OIDC-only mode. |
| `effect-ci-demo-site` / `test/apps/demo-site` | `DemoSitePublisher` export; immutable asset storage; matching public origin in the shared protocol. |
| `effect-ci-release-manager` / `test/apps/release-manager` | `HMD_DEPLOY_TOKEN` for the destination account; destination account constant; deployed `effect-ci-hmd-demo`. |
| `effect-ci-repair-events` / `test/apps/repair-events` | Notification secret, destination/policy/automation, source/version enrollment; bindings back to the main host and incident source when enabled. |
| `effect-ci-repair-agent` / `test/apps/repair-agent` | Generated Flue exports; bindings to repair AI and repair events. |
| `effect-ci-repair-ai` / `test/apps/repair-ai` | Workers AI binding and durable inference budget ledger. |
| `effect-ci-repair-incident` / `test/apps/repair-incident` | Issues configuration and `PUBLIC_READINESS` binding back to the main host. |
| `effect-ci-hmd-demo` / `test/apps/hmd-demo` | Initial healthy version and destination-account release versions. |
| `effect-ci-docs` / `apps/docs` | Public URL and its separate Workers Builds trigger. Main CI does not deploy this Worker. |

Inventory other deployed example/test hosts separately. Moving only the CI host
does not remove their resources or their charges from the source account.

## Prepare destination configuration and credentials

1. Select the work account as described in [Choose the account](./SELF-HOST.md#choose-the-account).
   Use a separate managed worktree for migration edits. Keep the source inventory
   and source credential references available until the move is verified.
2. In `apps/effect-ci/.env.production`, set `EFFECT_CI_PROFILE=demo`,
   `EFFECT_CI_WORKER_NAME=effect-ci-github-cloudflare`, the destination account ID,
   and `EFFECT_CI_PUBLIC_URL=https://effect-ci-github-cloudflare.<work-subdomain>.workers.dev`.
   The demo configuration fixes its Worker name; the standalone name setting does
   not rename it. Use that hostname in **all** copied Access request files too.
3. Reuse the existing GitHub App, key, webhook secret and installations. Preserve
   its existing permissions and subscriptions, including **Push** for showcase
   routing and **Workflow job** for the runner. Do not replace these with the
   new-host guide's smaller permission/event set. Leave its webhook pointing at
   the source until destination deployment is complete.
   If its private key is unavailable on this machine, generate another key on
   the **same App** and store it securely; do not create a replacement App. The
   old key can remain valid during cutover. A new webhook secret can be configured
   on the destination first, then changed in the App when switching its URL.
4. Create destination Access applications using [Configure Access](./SELF-HOST.md#configure-access).
   Also preserve the narrow `/webhooks/slack` bypass used by Slack callbacks.
   Set the new issuer/audience in the host environment. Update
   `src/demo-access-policy.ts` with the new host origin, Access issuer/audience,
   and SHA-256 of the intended human's new Access subject. The integrated host
   verifies this source-owned identity in addition to the environment settings;
   changing environment values alone does not update it. Derive the subject from
   a verified destination Access session without printing the JWT.
5. Update account-specific source settings before building:

   | Source | Required destination value |
   | --- | --- |
   | `packages/cloudflare/src/demo-site.ts` | `demoSiteOrigin` for the work account. Publisher and consumers must agree. |
   | `test/apps/release-manager/src/release-manager.ts` | `RELEASE_ACCOUNT` for the work account. Keep `RELEASE_SCRIPT` aligned with the HMD demo Worker. |
   | `apps/effect-ci/src/demo-access-policy.ts` | Host origin and verified human Access identity, as above. |
   | `apps/docs/astro.config.mjs`, `apps/docs/builds.json` | Docs URL and a newly configured destination Workers Builds trigger. Source-account trigger IDs cannot be reused. |

   Search the runtime sources for the old hostname and account ID and review
   each result. Historical receipts are evidence from the old account; leave
   those records intact. Fixture expectations that encode the old origin need
   separate review before changing the shared protocol's origin.
6. Restore credentials to the Worker that owns them:

   | Owner | Credential/settings |
   | --- | --- |
   | Main host | Existing GitHub App credentials; host API token; signing key; new public URL; new Access issuer/audience; numeric GitHub owner allowlist. |
   | Main host, automatic main deployments | Destination `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. This is the host-only deployment proxy credential, separate from the short-lived OIDC token issuer. |
   | Main host, short-lived app deployments | Destination `CLOUDFLARE_TOKEN_ISSUER` and destination-account `EFFECT_CI_OIDC_SCOPES`. Follow [deployment credentials](./SELF-HOST.md#enable-short-lived-deployment-credentials). |
   | Main host, Slack | Existing bot token, signing secret, App/team/channel IDs and approver IDs. Set `EFFECT_CI_DETAILS_URL` to the work account's Workflow URL. |
   | Actions runner | `RUNNER_APP_PRIVATE_KEY` and `RUNNER_WEBHOOK_SECRET` from the same GitHub App. Preserve any separately configured runner OIDC grants if they are used. |
   | Release manager | Destination-account `HMD_DEPLOY_TOKEN`. |
   | Repair events | The notification receiver's shared secret, matching its destination-account webhook destination. |

   Use 1Password and ignored manifests as described in [credential setup](./SELF-HOST-ENV.md).
   The current main-host `secrets.env` covers the standalone settings only: extend
   it with the required Slack/CD bindings and add matching sensitive provider
   references to `.env.schema` before deployment. A value in a local shell or
   1Password is not automatically a Worker secret. Keep the CD credential in the
   host; project containers continue to receive only the proxy's dummy credential.

   If 1Password is not available on the destination machine, do not use a public
   paste service to move credentials. Generate new GitHub App/Cloudflare/host
   credentials where possible. Retrieve Slack credentials through the existing
   Slack app's authorized settings, or transfer an encrypted credential file
   directly through an approved secure channel. Put any temporary credential
   files outside Git with owner-only permissions, and keep their contents out of
   chat and shell history. The new-host Varlock commands require their configured
   provider; they will not work until that provider is available or the deployment
   uses a separately prepared private secrets manifest.

## Deploy the connected apps

Deploy every target in the destination account. The same Worker name in the
source account cannot satisfy a destination service binding.

1. Deploy the independent apps first: Actions runner, demo site, healthy HMD demo,
   release manager and repair AI. Build each from its owning directory and supply
   only that app's credential manifest. Follow the existing app instructions for
   the [runner](../github-actions-runner/README.md),
   [demo site](../../test/apps/demo-site/README.md),
   [release manager](../../test/apps/release-manager/README.md) and
   [repair AI](../../test/apps/repair-ai/README.md).
2. Break the repair binding cycle during bootstrap: set the destination source's
   `test/apps/repair-events/src/public-enrollment.ts` enrollment to `undefined`.
   Its config then omits its bindings to the not-yet-deployed main host and incident
   source. Deploy the receiver with its secret, then the generated repair agent.
   Do not substitute placeholder services or copy the old source/version IDs.
3. Build and deploy the main host with the `demo` settings and complete secret
   manifest. Verify the deployed service bindings point to the five destination
   Workers in the inventory. Verify all declared Workflows, containers and Durable
   Objects were provisioned. Then deploy the repair incident source, whose
   readiness binding can now resolve the main host.
4. Recreate Notifications/Issues configuration and enroll the new source/version
   using [the receiver reproduction guide](../../test/apps/repair-events/REPRODUCE.md).
   Restore the receiver's public enrollment and redeploy only after those IDs
   have been independently verified. Repair writer/agent enrollment also pins
   source evidence; redeploying code does not recreate that evidence.
5. Deploy the docs Worker and recreate its Builds trigger separately. Review the
   deployed resource metadata in the destination account before switching callers.

Cloudflare state starts fresh: Workflow histories, check caches, immutable demo
assets, release versions/journals, notification captures and inference reservations
do not follow a Git push. Publish a fresh preview and create destination release
versions before demonstrating rollout. A fresh budget ledger does not renew an
old inference budget; reconcile prior spending and approve the destination budget
before running paid repair inference. Existing notebooks are not proof of the new
account's setup.

## Switch callers and verify every flow

1. Change the existing GitHub App's homepage and webhook URL to the new host and
   enable deliveries. Change Slack's interactivity URL to the new host's
   `/webhooks/slack`. Preserve signing secrets and existing App installations.
2. Change each app's public `EFFECT_CI_REMOTE_URL` to the new origin. Update the
   GitHub repository variable with that name too: `.github/workflows/e2e.yml`
   and `oidc-live-proof.yml` read it. Remove old shell/profile overrides. Sign in
   through destination Access and run `effect-ci oidc` from each app checkout;
   commit the regenerated `.cloudflare/ci/oidc.json`. This registers that same
   GitHub repository with the new host's fresh registry; it does not move it.
3. Push a small branch change to this testbed. Require successful signed webhook
   delivery, the existing per-action checks, native Workflow completion in the
   work account, and stopped build containers. Run the walkthrough's
   `effect-ci doctor --remote` and `effect-ci run build --remote` against the new host.
4. Run the runner's enrolled push-triggered smoke workflow. Verify native GitHub
   step output, its temporary runner identity, container shutdown and GitHub
   deregistration. An HTTP health response is not runner acceptance.
5. Verify a destination-account app deployment through OIDC. Verify the main
   branch's automatic runner/host deployment separately: it uses the host's
   deployment proxy, not the app OIDC wrapper. Inspect the deployed account and
   preserved secrets/bindings after that self-update.
6. Verify showcase preview publication and the Slack Progress/Reject callbacks,
   then the approved staged rollout and restoration path against the destination
   HMD demo. Verify repair notification capture, admission, proposal and proposed
   change using fresh destination evidence and the approved budget. Record each
   result independently; a working CI push does not establish these flows.

## Remove personal-account hosting

After destination acceptance, drain the old runner and reconcile its registration
and container cleanup as described in its README. Disable the source account's
Builds triggers, Issues automations and notification policies so they cannot keep
starting work. Keep the GitHub App and Slack callbacks pointing at the work host.

Use [host teardown](./SELF-HOST.md#optional-tear-down-an-existing-host) against the
saved source-account resource inventory, including the supporting apps. Deletion
removes stored history and old published URLs. Review subscriptions separately;
resource deletion does not cancel a paid plan.

If avoiding overlapping hosting cost requires teardown first, save the inventory
and credentials first and accept remote-CI/demo downtime until all destination
checks above pass. Never delete an unresolved active release or runner journal
to force the cutover.
