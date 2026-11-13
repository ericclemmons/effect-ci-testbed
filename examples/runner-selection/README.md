# Choose where CI runs

Move CI between GitHub-hosted and self-hosted runners without rewriting actions.

The snippets on this page come from this example's files, which CI runs end to
end.

## Keep the workflow portable

The actions and workflow say nothing about where they run. These actions check
out the source, install dependencies, and run `npm test`:

[`.cloudflare/ci/actions.ts`](./.cloudflare/ci/actions.ts "source")

The workflow runs the test action:

[`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts "source")

## Select the runner in the GitHub entrypoint

Create `.github/workflows/effect-on-github.yml`. It passes the runner labels from
the `EFFECT_CI_RUNS_ON` repository variable to the shared Effect CI workflow:

[`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml "source {16}")

Set the GitHub repository variable `EFFECT_CI_RUNS_ON` to runner labels:

```json
["self-hosted", "linux", "x64"]
```

Omit it to use `ubuntu-latest`. The GitHub entrypoint selects the runner; the
portable workflow stays unchanged.

## Run locally

```sh
cd examples/runner-selection
effect-ci run
```

[Blacksmith](../blacksmith) shows the same pattern with a hosted runner provider.

## Compare with GitHub Actions

A plain GitHub Actions job reads the same variable in `runs-on`:

[`.github/workflows/github.yml`](./.github/workflows/github.yml#L12-L21 "source {2}")
