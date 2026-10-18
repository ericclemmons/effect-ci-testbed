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

Fill in your account, hostname and Access reviewers. [Create your App](./README.md#2-register-the-github-app)
and [configure its secrets](./README.md#3-configure-worker-secrets) before the final
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
project env file. [Private CLI profile](./README.md#private-cli-profile) shows its
format; [Access setup](./README.md#4-protect-operator-routes-with-access) explains
the separate authentication boundary. Run `cf-ci doctor --remote` before
dispatching work.

The [standalone workflow](./src/standalone-program.ts) installs with the project's
detected package manager and runs `build` by default. `test build` selects both
goals with shared installation. Edit this host-authored workflow to encode your
org policy; project scripts execute inside the workspace, not the host.
The standalone image includes Node 24.22 and pnpm 12.8.1; it does not require
pnpm to happen to be installed in the base image.
Project commands run as uid 1000 in a non-login shell; Node and pnpm stay
root-owned. Add system tools when building your image, not from project scripts.
Transport caches are isolated by the platform-resolved image and container policy.
Rebuilding an image starts a new cache; an unresolved mutable image name runs
fresh. A restored workspace is not, by itself, attestation or permission to skip
an action.

Slack is optional. Configure your own `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID`, or
webhook destination. No channel or reviewer identity is copied from the demo.

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
graph tests use another project's pnpm files. The actual image also runs a clean
tracked pnpm fixture's install/test/build with networking disabled and no host
secrets. A separate CI job builds this profile without Cloudflare credentials or
owned demo services. These are not a fresh-account live
deployment. The existing live demo is a separate regression fixture.

SDK hosts can [sign actual check/action results](../../packages/cloudflare/src/execution-receipt.md)
and [keep a private commit journal](../../packages/cloudflare/src/execution-journal.md).
This profile does not automatically enroll signing keys, verify complete inputs or
restore reusable outputs. The demo's fixed signing/repair policy is not required
to deploy a basic CI host.
GitHub event runs use the installed App's scoped checkout credential. Remote CLI
runs resolve your App's installation for that repository and borrow a
Contents-read token for checkout, then revoke it. Install the App on private
repositories you intend to run; no installation ID or token belongs in CLI input.
Repositories without an installation use anonymous checkout. Local Workflow tests
exercise this path with fake GitHub responses; a fresh-account private checkout
has not yet been live-verified.
