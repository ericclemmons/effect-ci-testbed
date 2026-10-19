# Effect CI: a hands-on tour

An ordinary Vite app. Your own disposable repository. Make changes, type the
commands, inspect what happened, then delete what you created.

This directory is a **template**, not the directory where you rehearse. No setup
script, worktree, inherited secrets or sibling app imports are required. The app
installs and builds independently; the unpublished Effect CI CLI/SDK are linked
from your development checkout while we work on them.

**Current boundary:** the local app, task cache, source selection, local output
publication and direct Cloudflare deployment below are runnable. The existing
host's attestation, Slack, approval and release policies are still enrolled to
the original fixture repository. A new GitHub repository is **not** automatically
enrolled by installing the App. Those hosted chapters are not yet a runnable
continuation of this tutorial. Do not use the monorepo's `main` as a substitute.

## 0. Prepare the development CLI once

Use Node 24.11+ and pnpm 12.8.1. In the Effect CI monorepo, keep this shell:

```sh
pnpm install
export EFFECT_CI_REPO="$PWD"
export PATH="$EFFECT_CI_REPO/node_modules/.bin:$PATH"
cf-ci --help
```

PATH exposes the development CLI without installing a global package. Nothing
here deploys a CI host or changes your Cloudflare/GitHub login.

## 1. Copy the app out of the monorepo

```sh
export DEMO_PARENT="$(mktemp -d -t effect-ci-demo)"
cd "$DEMO_PARENT"
pnpm dlx tiged ericclemmons/effect-ci-testbed/apps/demo demo
cd demo
pnpm install
pnpm dev
```

Open the local Vite URL. Click **Test JavaScript**. Stop the server with Ctrl-C
when ready to continue. `tiged` copies files without the monorepo's Git history.
Until this template is merged, use the tutorial PR's branch after `#` in the
`tiged` source, rather than expecting it to exist on `main`.

The app has no Effect CI dependency yet. Its scripts and Vite configuration are
ordinary app code. `packages/greeting/message.ts` is a shared source module inside
this new repo, not an import from the Effect CI checkout.

## 2. Give it its own GitHub repository

Pick a unique name. Keep these values in this shell for teardown:

```sh
export DEMO_NAME="effect-ci-demo-$(date +%Y%m%d-%H%M%S)"
export DEMO_OWNER="$(gh api user --jq .login)"
export DEMO_REPO="$DEMO_OWNER/$DEMO_NAME"
export DEMO_WORKER="$DEMO_NAME"
git init --initial-branch=main
git add .
git commit -m "Start the Vite demo"
gh repo create "$DEMO_REPO" --private --source=. --remote=origin --push
git remote set-head origin main
```

This repository's `main` is the landing/release branch. All tutorial edits happen
here, never on the Effect CI monorepo's `main`. GitHub login is separate from
Cloudflare login. Keep the generated repository/Worker names for cleanup if you
close this shell.

## 3. Discover and run existing scripts

```sh
cf-ci
cf-ci list
cf-ci plan --format=mermaid
cf-ci run test build
AI_AGENT=true cf-ci run test build
```

Human output and structured agent output use the same execution path. Discovery
does not rewrite the project. An explicit run may create an ignored empty CI
marker. No GitHub push, Cloudflare deployment or model call is hidden here.

## 4. See an actual task-cache hit

```sh
time cf-ci run build
time cf-ci run build
```

Inspect Vite+'s hit/miss output. Edit the greeting and repeat: changed build
inputs invalidate the build. Task caching saves computation; it is not a signed
statement that another runner should trust your laptop.

## 5. Adopt a workflow, then distinguish source from output

The SDK is currently unpublished. Link the development package explicitly; this
is local tooling, not an application runtime dependency or a hosted enrollment:

```sh
mkdir -p node_modules/@effect-ci-testbed
ln -s "$EFFECT_CI_REPO/packages/ci" node_modules/@effect-ci-testbed/ci
mkdir -p .cloudflare/ci
cp tutorial/workflow.ts .cloudflare/ci/workflow.ts
git add .cloudflare/ci/workflow.ts
git commit -m "Adopt the demo workflow"
cf-ci plan --format=mermaid
cf-ci run
cf-ci run
```

Read `.cloudflare/ci/workflow.ts`: ordinary `if` statements, not a condition DSL.
Shared checkout runs once. The build is requested before output comparison; the
second run keeps the same local publication when the deployable bytes match.
This lesson publishes to `.effect-ci/deployed-site`, **not Cloudflare**.
The SDK symlink is ignored and changes no package/lockfile. Recreate it after a
fresh install if necessary. It deliberately depends on the developer checkout;
the app's own source, tests and build do not. Do not commit machine-specific
`link:` overrides or absolute paths into the disposable repository.

### README change: no TypeScript lint, no changed app output

```sh
git switch -c demo/readme
printf '\nA README-only tutorial change.\n' >> README.md
git add README.md
git commit -m "Explain the demo"
cf-ci run
```

`source.changed(["**/*.ts", "package.json", "pnpm-lock.yaml"])` selects lint.
The new repo's recorded default branch supplies the normal comparison. Missing
comparison data or a dirty checkout conservatively runs work rather than silently
skipping it. This is an explicit watchlist, not automatic dependency discovery.

### Shared-module change: same app source, different app output

Edit `packages/greeting/message.ts` to say `Shared code ships too.` Then:

```sh
git add packages/greeting/message.ts
git commit -m "Change the shared greeting"
cf-ci run
cf-ci run
```

Lint runs for the TypeScript change. Vite builds the importing app. Its output
changes even though `src/app.ts` did not. `workspace.changed("dist/**")` publishes
the new output once, then skips the identical publication. It compares complete
output bytes/configuration with this destination's last successful publication,
not Git commits or snapshot IDs. A failed build cannot advance that baseline.

## 6. Deploy a real disposable Cloudflare app

Use your existing Wrangler login. `wrangler` and the host's `cf` CLI can have
separate saved OAuth sessions: if necessary, run `pnpm exec wrangler login`.
Do not copy account tokens into `.env` or project code.

```sh
pnpm exec wrangler whoami
pnpm build
pnpm exec wrangler deploy --name "$DEMO_WORKER"
```

Open the exact Workers URL returned by deployment. This serves `dist`, not the
repository or `.env`. The explicit `--name` avoids overwriting the template's
default name. Check the account shown before deploying. There are **no AI,
container, KV, R2, Durable Object or scheduled-trigger bindings** in this app.
This manual deployment does not yet reuse the local lesson's publication baseline.
[Cloudflare static-assets deployment](https://developers.cloudflare.com/workers/static-assets/get-started/).

## 7. Hosted chapters being connected

The following belong in this same tour, but are not enabled by the commands above:

- Hosted test/build, Slack and exact-source signed attestation; then verify rather
  than re-execute those results when SCM CI runs.
- Preview on a feature branch, publish only changed deployable output, and release
  from this disposable repository's `main` with human Progress/Reject controls.
- README-only policy approval/merging after canonical diff and required checks;
  code changes go through normal review. No CODEOWNERS impersonation or CI bypass.
- Failure inspection and a new attempt that reuses valid completed work without
  replaying deployments or approvals.
- A **modeled** error → proposed patch → verification → PR agent flow. No AI binding
  or paid model execution by default; no always-on repair loop.

`cf-ci doctor --remote` is an optional no-dispatch preflight, not a required ritual.
Normal remote commands should provide actionable authentication/capability errors.
Do not point a fresh repo at the fixed demo URL and assume it is enrolled.

## 8. Tear down what you created

Keep this shell in the disposable repo. These commands intentionally prompt:

```sh
printf 'Worker: %s\nGitHub repo: %s\n' "$DEMO_WORKER" "$DEMO_REPO"
pnpm exec wrangler delete "$DEMO_WORKER"
gh repo view "$DEMO_REPO"
gh repo delete "$DEMO_REPO"
```

Verify the exact names and Cloudflare account before confirming deletion. The
Worker deletion removes this app's deployed assets; GitHub repository deletion is
destructive, so retain any commits/evidence you want first. Do not delete the
shared Effect CI host, App, Access application, account or historical fixtures.
If you skipped deployment/repo creation, skip its deletion too.

Stop `pnpm dev` if still running. The local directory is yours to keep or move to
Trash after inspecting it; there is no recursive delete command targeting an
environment variable. Close the shell to discard the PATH/tooling setup.
