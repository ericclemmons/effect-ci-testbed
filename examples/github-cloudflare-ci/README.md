# Run GitHub CI on Cloudflare

Keep source and checks on GitHub while Cloudflare runs checkout, install, and build.

The signed GitHub event selects a commit. A native Cloudflare Workflow executes
the [portable actions](./.cloudflare/ci/actions.ts) and reports progress to GitHub.

## Run locally

```sh
cd examples/github-cloudflare-ci
effect-ci run
```

For hosted execution, configure the GitHub App and service using the
[host guide](../../apps/effect-ci/README.md). Remote dispatch runs that service's
configured program against a pushed commit; it does not upload local edits.

[Workflow](./.cloudflare/ci/workflow.ts) · [Add Slack approval](../cloudflare-hitl-release)
