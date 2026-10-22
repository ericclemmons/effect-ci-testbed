# Self-host Effect CI

Your Cloudflare account. Your GitHub App. Your notification destinations.

Use `standalone`, not the owned demo profile:

```sh
pnpm install
cd apps/effect-ci
cp deploy.example.env .deploy.env
cp secrets.example.env .secrets.env
$EDITOR .deploy.env .secrets.env
pnpm exec cf auth login
pnpm run deploy -- --dry-run
pnpm run deploy -- --secrets-file .secrets.env
```

Fill in your account, hostname and Access reviewers. [Create your App](#github-app)
and [configure its secrets](#secrets) before the final
deploy. Keep both local files ignored; never put credentials in project code.
The deploy wrapper configures Access before deploying the Worker.
`pnpm build` and `pnpm dev` read the same profile from `.deploy.env`; neither
reconciles Access nor deploys the host.

## Choose the host

| Setting | Standalone default |
| --- | --- |
| `EFFECT_CI_PROFILE` | `standalone` in the template |
| `EFFECT_CI_WORKER_NAME` | `effect-ci` |
| `EFFECT_CI_PROJECT_ROOT` | `.` relative to the checked-out repository |

Match the public hostname to your Worker. Set the project root to `apps/web`, for
example, if that package owns the scripts and lockfile. Install your App only on
repositories you intend to run. The remote API requires your private API token;
the owned demo's Access identity is not inherited.

For the CLI, configure your host origin as `EFFECT_CI_REMOTE_URL` (no `/demo`
suffix) and keep the API token in a private user-owned remote profile, not a
project env file. [CLI authentication](#cli-authentication) shows its format;
[Access setup](#access) explains the separate authentication boundary.
`cf-ci doctor --remote` is an optional preflight; normal commands perform their
own authentication and capability checks.

The [standalone workflow](./src/standalone-program.ts) installs with the project's
detected package manager, then runs `cf-ci run --local` inside the workspace.
It discovers the project's `.cloudflare/ci/workflow.ts` (including a configured
nested root), or uses the CLI's package-script discovery when no workflow exists.
The host does not import project code. `cf-ci run --remote` runs the whole workflow;
`cf-ci run test build --remote` selects exported actions. The standalone host
advertises project goal discovery, then validates the requested names through the
real CLI inside the isolated workspace. Fixed-goal hosts keep their allowlists.
The standalone image includes Node 24.22, pnpm 12.8.1 and the locked CLI/SDK
runtime. Building the standalone profile packages its production dependencies;
project manifests do not need a local SDK link.
Project commands run as uid 1000 in a non-login shell; Node and pnpm stay
root-owned. Add system tools when building your image, not from project scripts.
Transport caches are isolated by the platform-resolved image and container policy.
Rebuilding an image starts a new cache; an unresolved mutable image name runs
fresh. A restored workspace is not, by itself, attestation or permission to skip
an action.

Slack is optional. Configure your own `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID`, or
webhook destination. No channel or reviewer identity is copied from the demo.

## GitHub App

Create an App in GitHub's **Settings → Developer settings → GitHub Apps**:

- Homepage: your `EFFECT_CI_PUBLIC_URL` origin.
- Webhook: that origin plus `/webhooks/github`, with SSL verification enabled.
- Webhook secret: a new high-entropy value, saved privately.
- Permissions: **Checks: read/write**, **Contents: read**.
- Subscribe to **Check suite** events for ordinary CI and **Push** events when
  the host enrolls branch-sensitive push routing such as preview → release.

Record the App ID, generate its private PEM key, and install it on repositories
you intend to run. `check_suite.requested` starts ordinary CI after a push and
`check_suite.rerequested` supports GitHub's Re-run action. An explicitly enrolled
signed Push event retains the exact branch ref even when the commit already has a
check suite. The host rejects deleted, forced, tag and malformed push updates,
then deduplicates the delivery ID before starting a Workflow.
PR approvals and repair writers need separate capabilities; basic CI needs neither.

## Secrets

Fill the ignored `.secrets.env` from `secrets.example.env`: `GITHUB_APP_ID`,
`GITHUB_PRIVATE_KEY` (original multiline PEM), `GITHUB_WEBHOOK_SECRET`,
`EFFECT_CI_API_TOKEN` and `EFFECT_CI_PUBLIC_URL`.
Use an independently generated API token, not the webhook secret. Keep values out
of shell history and checked-in example files. The final setup deploy above uploads
the file atomically; build/dev do not upload secrets.

## Access

The deploy wrapper reconciles the checked-in `access.config.ts` before deploying:
protect the hostname with your reviewer Allow policy and bypass only the exact
`/webhooks/github` path. GitHub cannot perform an interactive Access login, but the
Worker still requires its HMAC signature. Opting into Slack callbacks adds a narrow
`/webhooks/slack` exception, not a general webhook bypass.

Bare `cf deploy` does not configure Access. Use `pnpm run deploy:access` to reconcile
only Access, or the setup deploy command to configure both. Normal monorepo CD
preserves the existing Access configuration rather than reconciling it on every push.

Verify that an unauthenticated visit to `/` redirects to Access, unsigned webhooks
return `401`, and an unauthenticated `/runs` request cannot start work. A protected
origin shows `{"service":"Effect CI","status":"ready"}` after login.
The Worker API token remains a second boundary after Access succeeds.

## CLI authentication

Use the existing human Access session, then retry the original CLI command:

```sh
cloudflared access login "$EFFECT_CI_PUBLIC_URL"
```

Without explicit Access headers, `cf-ci` reads the application-scoped session through
`cloudflared` and keeps the JWT in memory. It does not initiate browser login.
For unattended clients, add a Service Auth Access policy and provide its
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` pair privately instead.

Standalone execution also needs the Worker's API token. Configure a user-owned
`~/.config/effect-ci/remotes.json` (mode `600`, outside the checkout):

```json
{
  "version": 1,
  "remotes": [{
    "repository": "https://github.com/OWNER/REPOSITORY.git",
    "url": "https://ci.example.com",
    "token": "YOUR-EXISTING-WORKER-API-TOKEN"
  }]
}
```

Use the standalone host origin without `/demo`. An explicit URL override does not
inherit another endpoint's profile token. `EFFECT_CI_REMOTE_URL` and
`EFFECT_CI_REMOTE_TOKEN` are supported alternatives. Never put App keys, Slack tokens
or Access JWTs in the profile. The existing owned demo's separately enrolled
Access-only identity is not inherited by a new host.

## Run CI

From a clean, committed and pushed project with the App installed:

```sh
cf-ci run --remote
cf-ci run test build --remote
```

The CLI selects the host's advertised goals, streams native events and exits with
the result. It does not upload dirty files or an arbitrary local workflow module.
Push a commit to exercise the GitHub path: inspect the App's Recent deliveries,
the queued/per-action GitHub checks and the native Workflow history.
On a stream disconnect, inspect the returned run ID rather than starting another run.

If no event arrives, check App installation, Checks permission and Check suite
subscription. A webhook `401` usually means the webhook secrets differ; an API
`401` after Access means the Worker API token differs. Private checkout requires
Contents read and installation access to that repository. Git credentials stay
host-only in the checkout proxy and are revoked before project commands.

## Notifications

For one updated Slack card, supply `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID`, install
the Slack app with `chat:write`, and invite it to the channel. Alternatively use
`SLACK_WEBHOOK_URL` or `DISCORD_WEBHOOK_URL`. Private confidence images additionally
need `files:write`. No notification credential enters project containers.

Interactive approvals additionally require the signing secret, App/team/channel
IDs and reviewer IDs listed in `secrets.example.env`, plus the exact signed Slack
callback route. Notifications do not grant approval authority or add a release gate
to the root CI/CD workflow. See the [HITL example](../../examples/cloudflare-hitl-release/README.md).

## What this deploys

One Worker, one native CI Workflow and one workspace container. No preview-site,
release-manager, repair-agent or GitHub Actions runner service binding is required.
Standalone does not automatically publish or release your application.

`demo` retains the existing owned integrations. For backwards compatibility,
omitting `EFFECT_CI_PROFILE` also retains that configuration; new installations
should keep the template's explicit `standalone` choice.

## Proof boundary

The standalone profile is built with a different Worker name and project root.
Local workerd tests check its real entrypoint, API authentication and capabilities;
graph tests execute root and nested authored workflows through the real CLI.
The actual image runs a clean tracked pnpm fixture's install/test/build and custom
root/nested workflows with networking disabled, uid 1000 and no host secrets.
A separate CI job builds this profile without Cloudflare credentials or
owned demo services. These are not a fresh-account live
deployment. The existing live demo is a separate regression fixture.

SDK hosts can [sign actual check/action results](../../packages/cloudflare/src/execution-receipt.md)
and [keep a private commit journal](../../packages/cloudflare/src/execution-journal.md).
This profile does not automatically enroll signing keys, verify complete inputs or
restore reusable outputs. The demo's fixed signing/repair policy is not required
to deploy a basic CI host.
The outer host currently reports checkout/install/project-workflow boundaries,
not individual authored actions. Authored execution is not yet connected to host
approval, attestation or deployment capabilities; it does not restore the full
conference demo by itself.
GitHub event runs use the installed App's scoped checkout credential. Remote CLI
runs resolve your App's installation for that repository and borrow a
Contents-read token for checkout, then revoke it. Install the App on private
repositories you intend to run; no installation ID or token belongs in CLI input.
Repositories without an installation use anonymous checkout. Local Workflow tests
exercise this path with fake GitHub responses; a fresh-account private checkout
has not yet been live-verified.
