# Choose where CI runs

Move CI between GitHub-hosted and self-hosted runners without rewriting actions.

Set the GitHub repository variable `EFFECT_CI_RUNS_ON` to runner labels:

```json
["self-hosted", "linux", "x64"]
```

Omit it to use `ubuntu-latest`. The
[GitHub entrypoint](./.github/workflows/effect-on-github.yml) selects the runner;
the portable workflow stays unchanged.

## Run locally

```sh
cd examples/runner-selection
effect-ci run
```

[Blacksmith](../blacksmith) shows the same pattern with a hosted runner provider.
