# Run GitHub CI on Cloudflare

Keep source and checks on GitHub while Cloudflare runs checkout, install, and build.

The signed GitHub event selects a commit. A native Cloudflare Workflow executes
the portable actions below and reports progress to GitHub.

The snippets on this page come from this example's files, which CI runs end to
end.

## Define the actions

Create `.cloudflare/ci/actions.ts`. Start with the SDK import:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#L1 "source")

Check out the commit. This example's application lives in `app/`, so checkout
returns that directory as the workspace:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=checkout "source 'workspace.directory(\"app\")'")

Install dependencies, then build. Each action calls the one before it, so they
run in order:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=install "source")

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts#symbol=build "source")

## Define the workflow

Create `.cloudflare/ci/workflow.ts`. It returns the build, which runs checkout
and install first:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Run it locally

```sh
cd examples/github-cloudflare-ci
effect-ci run
```

## Run it on Cloudflare

For hosted execution, configure the GitHub App and service using the
[host guide](../../apps/effect-ci/README.md). Remote dispatch runs that service's
configured program against a pushed commit; it does not upload local edits.

To pause for a human before release, see
[Add Slack approval](../cloudflare-hitl-release).
