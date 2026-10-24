# cf-ci CLI

`cf-ci` discovers and runs a project's CI workflow, or dispatches it to a hosted
Cloudflare CI app. Run `cf-ci --help` for execution and planning commands.

## OIDC deployment

Run `cf-ci oidc --service https://your-hosted-ci-origin` once from a repository with
a GitHub remote. Authenticate through the hosted app's Cloudflare Access policy;
the command reuses configured Access credentials or the `cloudflared` session.
Established setups can use the existing `EFFECT_CI_REMOTE_TOKEN` too. Environment
files and aliases work as they do for `cf-ci run --remote`.

The GitHub App must be installed on the repository. Successful enrollment writes
`.cloudflare/ci/oidc.json` with the service origin and repository name. Commit that
file; it contains no credentials. Repeating enrollment is safe.

In CI, use `cf-ci oidc -- pnpm exec wrangler deploy` or
`cf-ci oidc -- pnpm exec cf deploy`. The command uses GitHub Actions OIDC (with
`id-token: write`) or a short-lived identity supplied by the hosted cf-ci runner.
It exports Cloudflare credentials only to the child command and revokes them when
the command exits. Deployment failures retain their exit code. `--scopes` requests
an explicit subset of the operator's permissions; it defaults to `workers:edit`.

The hosted operator controls Cloudflare account and permissions. Creating a new
Worker requires an account-scoped Workers Scripts Write policy, configured once
in the shared app. Project enrollment cannot grant itself arbitrary permissions.

[OIDC command](./src/oidc.ts#symbol=runOidc "source")

[Hosted service configuration](../../apps/effect-ci/README.md#unified-cli-and-workload-identity)


## Identity for remote execution

`cf-ci doctor --remote` and `cf-ci run --remote` automatically choose identity:
local users reuse their enrolled Cloudflare Access session; GitHub Actions and
hosted CI use their execution-platform identity. Dispatch, status, and logs all
use the same repository authorization. The CLI obtains fresh GitHub tokens as
requests are made, so reconnecting logs does not reuse an expired job token.

In GitHub Actions, give the job `permissions: id-token: write` and configure the
public `EFFECT_CI_REMOTE_URL`. Run `cf-ci oidc` once to enroll that repository, then
`cf-ci run --remote`. CI enrollment never changes the checkout and never needs
an Access secret or stored Effect CI API token. Local enrollment saves only the
public origin and repository name in `.cloudflare/ci/oidc.json`, which subsequent
remote commands discover automatically.

[Remote authentication](./src/workload-auth.ts "source")
