# Hosted example checks

> How do I verify the same consumer workflows in a real Cloudflare account?

This app imports the examples unchanged and gives each its own native Workflow.
It is separate from the GitHub/Slack service, has no secrets, and serves no HTTP
control plane. Instance creation and inspection require Cloudflare API credentials.

From the repository root:

```sh
pnpm install
pnpm --filter @effect-ci-testbed/example-runner exec cf deploy
```

Create an instance against a committed revision, using the authenticated `cf` CLI:

```sh
cf workflows instances create effect-ci-example-node-npm \
  --body '{"instance_id":"npm-1","params":{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"COMMIT_SHA"}}'

cf workflows instances get npm-1 \
  --workflow-name effect-ci-example-node-npm --simple true
```

| Example | Native Workflow |
| --- | --- |
| [npm](../../examples/node-npm) | `effect-ci-example-node-npm` |
| [pnpm](../../examples/node-pnpm) | `effect-ci-example-node-pnpm` |
| [Optional checks](../../examples/optional-checks) | `effect-ci-example-optional-checks` |
| [Durable workspace](../../examples/cloudflare-runner) | `effect-ci-example-workspace` |
| [Conditional deployment](../../examples/conditional-deploy) | `effect-ci-example-conditional-deploy` |
| [Python toolchain](../../examples/cloudflare-toolchain) | `effect-ci-example-python-toolchain` |
| [System packages](../../examples/system-package) | `effect-ci-example-system-package` |
| [Package-manager downloads](../../examples/package-manager-cache) | `effect-ci-example-package-manager-cache` |

A successful deployment alone does not verify an example. Inspect the completed
instance, action statuses, commands, and checkpoint history before marking the matrix.
Each run gets a distinct instance ID, so previous evidence is never overwritten.

The pnpm adapter bootstraps the pinned `pnpm@12.8.1` binary on the managed image,
just as the GitHub comparison uses `pnpm/action-setup`. This belongs to runner setup,
not the portable workflow. Project dependencies still install with the frozen lockfile.

To exercise event conditions, include a normalized event in instance parameters:
`"event":{"type":"push","ref":"refs/heads/main"}`. The conditional example
must run its echo-only deployment for that event and skip it for a pull request.
The source always uses the supplied immutable revision, independently of event/ref.

## Verified runs

The first hosted batch used source revision
`bfb695aa910e550c9bfc0a1412c1b4baefd75f7a`. Each instance retains its pinned
Workflow version and native history. These are real account runs, not local simulation.

| Example | Instance | Verified result |
| --- | --- | --- |
| npm | `coverage-node-npm-20261008-2` | checkout/install/lint/test/build complete; 34 native steps |
| pnpm | `coverage-node-pnpm-20261008-6` | frozen install/format/lint/test/build complete; 47 native steps; source revision `caba617c57ddc664020b955b63c275b8e4670256` |
| Optional checks | `coverage-optional-checks-20261008-2` | required lint passes; optional format warns; workflow succeeds; 25 steps |
| Durable workspace | `coverage-workspace-20261008-3` | checkout/install/build complete with live reuse disabled; 6 steps including workspace checkpoints; source revision `caba617c57ddc664020b955b63c275b8e4670256` |
| Main push condition | `coverage-conditional-push-20261008-1` | checkout and echo-only deploy complete; 4 steps |
| Pull-request condition | `coverage-conditional-pull_request-20261008-1` | deploy skipped, condition retained in plan, no container steps |
| Python toolchain | `coverage-python-toolchain-20261008-1` | apt installs Python/pip; pinned build tools produce a Python package; 7 native steps; source revision `caba617c57ddc664020b955b63c275b8e4670256` |
| System package | `coverage-system-package-20261008-1` | apt installs ImageMagick; downstream action verifies the binary; 6 native steps; same source revision |
| npm download cache, warm | `coverage-npm-cache-warm-20261008-1` | frozen install populates the cache; dependency verification passes; 22 native steps; same source revision |
| npm download cache, fresh offline run | `coverage-npm-cache-offline-20261008-2` | distinct instance restores the cache, runs `npm ci --offline`, and verifies the installed dependency; 23 native steps; same source revision |

View these in **Workers → Workflows → instance** in the deploying account, or use
`cf workflows instances get INSTANCE --workflow-name WORKFLOW --simple true`.

The pnpm runner uses `standard-1` for both initial startup and snapshot restoration.
Selected standalone projects ignore a parent pnpm workspace; an actual monorepo root
with its own `pnpm-workspace.yaml` retains normal workspace behavior.

For the download-cache example, pass
`"event":{"type":"workflow_dispatch","payload":{"offline":false}}` to the warm
instance, wait for completion, then use a new instance ID with `offline: true`.
Inspect the install command in the returned plan to confirm `--offline` was used.
The cache namespace is specific to this repository and example, not shared tenants.
