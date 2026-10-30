# CLI

`effect-ci` discovers and runs a project's CI workflow, or dispatches it to a hosted
Cloudflare CI app. Run `effect-ci --help` for execution and planning commands.

## Commands

| Command | Result |
| --- | --- |
| `effect-ci list` | Runnable project goals. |
| `effect-ci plan test build --format=mermaid` | Dependency graph; no execution. |
| `effect-ci run test build` | Execute selected goals locally. |
| `effect-ci run test build --remote` | Dispatch advertised goals to an enrolled host. |
| `effect-ci doctor --remote` | Check host access without starting a run. |
| `effect-ci oidc -- <command>` | Run a child with temporary deployment credentials. |

`AI_AGENT=demo` selects agent-friendly JSON. `--format=text|json` overrides detection;
`plan` also supports `--format=mermaid`.

Without a workflow, every `package.json` script is an action. In Vite+ projects,
tasks under `run.tasks` in `vite.config.ts` are actions too. Install the project's
dependencies first so the CLI can use its Vite+ config loader. Vite+ owns task
dependencies and caching; Effect CI invokes config tasks with `vp run <name>`.
A name cannot appear in both package scripts and Vite+ tasks.

Auto-discovered projects require an action name: `effect-ci run build`.
Bare `effect-ci run` fails before initialization or execution. `list` and `plan`
work without a name. The first named local run creates an empty
`.cloudflare/ci/ci.ts` marker; help, list, and plan do not write it. An authored
workflow takes precedence and retains its default workflow. Export actions to
make them CLI goals; keep private prerequisites unexported.

The package is unpublished. Install this repository's dependencies and add its
`node_modules/.bin` to `PATH`. The executable is `effect-ci`.

[CLI entrypoint](./src/effect-ci.ts "source")

## OIDC deployment

Run `effect-ci oidc --service https://your-hosted-ci-origin` once from a repository with
a GitHub remote. Authenticate through the hosted app's Cloudflare Access policy;
the command reuses configured Access credentials or the `cloudflared` session.
Established setups can use the existing `EFFECT_CI_REMOTE_TOKEN` too. Environment
files and aliases work as they do for `effect-ci run --remote`.

The GitHub App must be installed on the repository. Successful enrollment writes
`.cloudflare/ci/oidc.json` with the service origin and repository name. Commit that
file; it contains no credentials. Repeating enrollment is safe.

In CI, use `effect-ci oidc -- pnpm exec wrangler deploy` or
`effect-ci oidc -- pnpm exec cf deploy`. The command uses GitHub Actions OIDC (with
`id-token: write`) or a short-lived identity supplied by the hosted effect-ci runner.
It exports Cloudflare credentials only to the child command and revokes them when
the command exits. Deployment failures retain their exit code. `--scopes` requests
an explicit subset of the operator's permissions; it defaults to `workers:edit`.

The hosted operator controls Cloudflare account and permissions. Creating a new
Worker requires an account-scoped Workers Scripts Write policy, configured once
in the shared app. Project enrollment cannot grant itself arbitrary permissions.

[OIDC command](./src/oidc.ts#symbol=runOidc "source")

[Hosted service configuration](../../apps/effect-ci/README.md#unified-cli-and-workload-identity)


## Identity for remote execution

Human remote runs show command output and the same CI summary as local runs.
Hosted command output arrives when each command finishes. Cloudflare's internal
step and attempt records remain available in JSON output.

`effect-ci doctor --remote` and `effect-ci run --remote` automatically choose identity:
local users reuse their enrolled Cloudflare Access session; GitHub Actions and
hosted CI use their execution-platform identity. Dispatch, status, and logs all
use the same repository authorization. The CLI obtains fresh GitHub tokens as
requests are made, so reconnecting logs does not reuse an expired job token.

In GitHub Actions, give the job `permissions: id-token: write` and configure the
public `EFFECT_CI_REMOTE_URL`. Run `effect-ci oidc` once to enroll that repository, then
`effect-ci run build --remote`. CI enrollment never changes the checkout and never needs
an Access secret or stored Effect CI API token. Local enrollment saves only the
public origin and repository name in `.cloudflare/ci/oidc.json`, which subsequent
remote commands discover automatically.

[Remote authentication](./src/workload-auth.ts "source")
