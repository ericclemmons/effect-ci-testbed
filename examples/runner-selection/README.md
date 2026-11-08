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

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) runs `npm ci` and `npm test`
on the container size in `CF_CI_INSTANCE_SIZE` at deploy time, like `runs-on`
from a repository variable. It defaults to `standard-1`. It does not use Effect
CI.

```sh
(cd examples/runner-selection/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs runner-selection
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
