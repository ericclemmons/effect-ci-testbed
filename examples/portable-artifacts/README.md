# Publish a restorable build artifact

This example answers one question:

> When a later workload needs build output, what crosses the runner boundary?

Most actions should simply return the next `CI.Workspace`. An explicit artifact is for
cross-workload or retained output. `CI.Artifact.publish` records owned paths and asks the
runner to checkpoint the workspace; `restore` materializes it using the same runner
configuration. User code never handles a Cloudflare snapshot ID, GitHub artifact ID, or
local path.

The first slice checkpoints the whole workspace while preserving the selected paths in
the plan. Runners can later optimize transport to those paths without changing this API.

Run the canonical workflow locally with
`./examples/portable-artifacts/.cloudflare/ci/workflow.ts`. Compare
[the conventional GitHub workflow](./.github/workflows/github.yml) with
[Effect on GitHub](./.github/workflows/effect-on-github.yml). Artifact planning and
execution assertions live in
[`tests/portable-artifacts.test.ts`](./.cloudflare/ci/tests/portable-artifacts.test.ts).
