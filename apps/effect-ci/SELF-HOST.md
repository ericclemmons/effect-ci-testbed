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
project env file. [Authentication setup](./README.md#4-protect-operator-routes-with-access)
explains Access and the separate API token. Run `cf-ci doctor --remote` before
dispatching work.

The [standalone workflow](./src/standalone-program.ts) installs with the project's
detected package manager and runs `build` by default. `test build` selects both
goals with shared installation. Edit this host-authored workflow to encode your
org policy; project scripts execute inside the workspace, not the host.

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
graph tests use another project's pnpm files. These are not a fresh-account live
deployment. The existing live demo is a separate regression fixture.

General trusted-result issuance/reuse and PR policy enrollment are still being
generalized. This profile does not pretend the demo's fixed signing/repair policy
is portable, nor does it require that policy to deploy a basic CI host.
GitHub event runs use the installed App's scoped checkout credential. Remote CLI
checkout of private repositories still needs generalized host enrollment; do not
mistake a successful public-source run for that capability.
