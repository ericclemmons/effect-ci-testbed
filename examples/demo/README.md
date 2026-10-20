# Effect CI demo

Start with a Vite app, run its existing checks, then add a workflow that skips
unnecessary work.

The conference tour is being connected: hosted cache/attestation, Slack approval,
safe-change approval, and modeled auto-fix. This copy currently runs the local
build/cache/output-comparison chapters. AI is off.

## Start the app

Requires Node 24.11+ and pnpm 12.8.1.

```sh
cd $(mktemp -d)
pnpm dlx tiged ericclemmons/effect-ci-testbed/examples/demo demo
cd demo
pnpm install
pnpm dev
```

Open the Vite URL. Stop the server with Ctrl-C.

## Run CI

Link the unpublished CLI and SDK from your Effect CI checkout. Replace the paths:

```sh
pnpm link /path/to/effect-ci-testbed/packages/cli /path/to/effect-ci-testbed/packages/ci
git init
git add .
git commit -m "Start the demo"
pnpm exec cf-ci run test build
```

Repeat the build to see Vite+ caching. Change `packages/greeting/message.ts` and
repeat: the importing app rebuilds.

## Add a workflow

```sh
mkdir -p .cloudflare/ci
cp tutorial/workflow.ts .cloudflare/ci/workflow.ts
git add .cloudflare/ci/workflow.ts
git commit -m "Add CI workflow"
pnpm exec cf-ci run
pnpm exec cf-ci run
```

The workflow builds, then compares `dist/**` with the last successful publication.
Identical output skips publication. This chapter publishes to a local directory,
not Cloudflare.

[Safe-change approval](../small-change) ·
[Remote CI setup](../../apps/effect-ci/SELF-HOST.md) ·
[Slack approval](../cloudflare-hitl-release)
