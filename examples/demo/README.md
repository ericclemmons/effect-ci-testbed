# Try Effect CI

Copy this Vite app into a temporary directory. Run its existing scripts, add a
workflow, make changes, then delete your demo app and repository.

Requires Node 24.11+ and pnpm 12.8.1. Hosted attestation, Slack and approval are
not connected to this standalone tutorial yet. The steps below run locally;
deployment uses your existing Cloudflare login. No AI calls or AI bindings.

## Prepare the CLI

From the Effect CI checkout, keep this shell:

```sh
pnpm install
export EFFECT_CI_REPO="$PWD"
export PATH="$EFFECT_CI_REPO/node_modules/.bin:$PATH"
cf-ci --help
```

## Create your app

```sh
export DEMO_PARENT="$(mktemp -d -t effect-ci-demo)"
cd "$DEMO_PARENT"
pnpm dlx tiged ericclemmons/effect-ci-testbed/examples/demo demo
cd demo
pnpm install
pnpm dev
```

Open the Vite URL and click **Test JavaScript**. Stop with Ctrl-C.

Give the app its own repository:

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

Keep these names for teardown. This new repo's `main` is your landing branch;
you won't change the Effect CI monorepo.

## Run existing scripts

```sh
cf-ci
cf-ci list
cf-ci plan --format=mermaid
cf-ci run test build
AI_AGENT=true cf-ci run test build
```

Same execution, human or structured agent output. No workflow file required.

## See a cache hit

```sh
time cf-ci run build
time cf-ci run build
```

Inspect Vite+'s hit/miss output. Change `packages/greeting/message.ts` and repeat:
changed inputs invalidate the build. A local cache hit is not a signed attestation.

## Add a workflow

The SDK is unpublished, so link it from your development checkout:

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

Read the workflow: ordinary `if` statements. Build, then compare `dist/**` with
the last successful publication. Identical output skips publication. This lesson
publishes to the local `.effect-ci/deployed-site` directory, not Cloudflare.
Recreate the ignored SDK symlink after a fresh install if necessary.

## Change a README, then a shared package

```sh
git switch -c demo/readme
printf '\nA README-only tutorial change.\n' >> README.md
git add README.md
git commit -m "Explain the demo"
cf-ci run
```

`source.changed(["**/*.ts", "package.json", "pnpm-lock.yaml"])` skips lint here.
Missing comparison data or uncommitted changes conservatively run the checks.

Now change `packages/greeting/message.ts` to say `Shared code ships too.`:

```sh
git add packages/greeting/message.ts
git commit -m "Change the shared greeting"
cf-ci run
cf-ci run
```

Lint runs. Vite rebuilds the importing app even though `src/app.ts` didn't change.
`workspace.changed("dist/**")` publishes changed output once, then skips the
repeat. It compares actual bytes/configuration, not commit or snapshot IDs.
A failed build keeps the previous successful baseline.

## Deploy to Cloudflare

```sh
pnpm exec wrangler whoami
pnpm build
pnpm exec wrangler deploy --name "$DEMO_WORKER"
```

Check the account before deploying; run `pnpm exec wrangler login` if needed.
Open the returned Workers URL. This deploys only static `dist` assets, with no
containers, databases or scheduled jobs. Never put account tokens in the app.
This manual deployment is separate from the local output-comparison lesson.

## Tear down

These commands prompt. Check the exact names before confirming:

```sh
printf 'Worker: %s\nGitHub repo: %s\n' "$DEMO_WORKER" "$DEMO_REPO"
pnpm exec wrangler delete "$DEMO_WORKER"
gh repo view "$DEMO_REPO"
gh repo delete "$DEMO_REPO"
```

Skip deletion if you skipped creation. Repository deletion is destructive; keep
anything you want first. Stop the dev server. Keep or trash the local directory.
Do not delete the shared CI host or GitHub App.

The [fresh-copy test](../../scripts/demo-tutorial.test.ts) exercises installation,
source selection, output comparison and failed-build baseline preservation.
