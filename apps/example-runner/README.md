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
| [Vite+ task cache](../../examples/vite-plus-cache) | `effect-ci-example-vite-plus-cache` |
| [Turborepo task cache](../../examples/turborepo-cache) | `effect-ci-example-turborepo-cache` |
| [Custom runner image](../../examples/custom-runner-image) | `effect-ci-example-custom-runner-image` |
| [Isolated snapshot fanout](../../examples/snapshot-fanout) | `effect-ci-example-snapshot-fanout` |
| [Project Node version](../../examples/node-version) | `effect-ci-example-node-version` |
| [Mise runtimes](../../examples/mise-toolchain) | `effect-ci-example-mise-toolchain` |
| [Exported actions](../../examples/exported-actions) | `effect-ci-example-exported-actions` |
| [Deployment hooks](../../examples/deploy-hook) | `effect-ci-example-deploy-hook` |

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
| Vite+ task cache | `coverage-vite-plus-hit-20261008-2` | fresh instance reports `cache hit, replaying`, 201 ms saved; 11 native steps; source revision `2fed7a1b3410566cf381acf95eb00d13e48e35d8` |
| Turborepo task cache | `coverage-turborepo-hit-20261008-1` | fresh instance reports 1 cached task, matching hash `f37d6ec47086f918`, 85 ms task run; 11 native steps; same source revision |
| Clean-source cache regression | `coverage-npm-cache-offline-20261008-3` | offline install and dependency verification pass after removing stale untracked files; 23 native steps; same source revision |
| Custom runner image | `coverage-custom-image-20261008-1` | checkout checkpoint restored into the project Dockerfile image; baked-in `Python 3.13.5` verified; 3 native steps; source revision `bc50897f2d6ff8a388bcc6a0af22886f89bfc2c4` |
| Isolated snapshot fanout | `coverage-snapshot-fanout-20261008-1` | prepare runs once; left/right start together and independently overwrite the same filename; 8 native steps with live reuse disabled; source revision `55be3e8c7bff809aa9a8a910f888bc86613922e0` |
| Project Node version | `coverage-node-version-20261009-1` | installs Node 22.20.0 and verifies the exact version after restoring its checkpoint; 8 native steps; source revision `931bb78e21dddb1ef3ac5db80969dea1e8cddeec` |
| Mise runtimes | `coverage-mise-toolchain-20261009-1` | installs Node 22.20.0 and Python 3.13.7 from mise.toml; both version checks pass after checkpoint restoration; 11 native steps; same source revision |

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

Task-cache proofs use a warm instance followed by a separate instance at the same
source revision. Checkout removes untracked build outputs and old dependencies,
preserving only declared cache paths. The next task restores its output from cache.
Turbo's native remote-cache API is disabled in this hosted proof; the runner transports
its filesystem cache. Vite+ detects the enclosing monorepo and uses the root
`node_modules/.vite/task-cache`, so the adapter also preserves that location.

The custom-image adapter builds the example's Dockerfile as a named image with
`cf deploy`; Docker must be running for this build. Other workflows continue to
select Cloudflare's managed Trixie image. Its hosted proof disables live workspace
reuse so the downstream check must materialize the preceding checkpoint.

The Node-version and Mise adapters use the host's `Dockerfile.mise`. It copies the
official Mise 2026.9.11 static binary from a digest-pinned image alongside the
Sandbox 1.0 shim; project runtimes are installed by the unchanged consumer actions,
not baked into the image. Both proofs disable live reuse and verify the installed
tools after restoring durable snapshots. These runs prove reuse within a Workflow,
not a cross-instance Mise cache hit.

## Native command-policy regressions

The deployment-hook proofs use source
`7da78080cbb5ad183e2ace73bf95d38d1a00d19d`. Both
`coverage-deploy-hook-deploy_hook-20261009-1` and
`coverage-deploy-hook-deployment-20261009-1` completed checkout, frozen `npm ci`,
real `cf build`, and credential-free `cf deploy --prebuilt --mode production --dry-run`
with live workspace reuse disabled (14 native steps each). No Worker was released.
`coverage-deploy-hook-pull_request-20261009-1` completed with the event condition
retained, deploy skipped, and zero native/container steps. This verifies event routing,
not a public HTTP webhook receiver.

`coverage-exported-actions-20261009-2` completed against source
`28b10e978463ca6db7dfa9cffdc95b1e7d82158e`: checkout and its checkpoint,
`node --check app/index.js` in the restored example workspace, and the check's final
checkpoint all succeeded (four native steps). Local CLI validation separately
confirmed that only `check` is listed and runnable; private `checkout` fails with
`CI_UNKNOWN_TARGET`. The hosted proof runs the default workflow, not a remote CLI
action-discovery endpoint.

These host-only probes never deploy resources or use secrets. They exercise the
adapter boundary separately from consumer examples:

| Instance | Result |
| --- | --- |
| `coverage-command-retry-20261008-1` | native command step fails twice, succeeds on attempt 3, then commits its workspace; source `deb4817d083b0ffda2a515d5fd8ca915bb8ce404` |
| `coverage-command-failure-20261008-2` | exactly one failed native attempt without an explicit retry policy; final Workflow error preserves exit 7 and stderr; source `bdaabeef68a3fd410abd0a542c5c91efa11ed837` |
| `coverage-optional-native-failure-20261008-4` | format's native step fails once but the consumer plan records a warning; lint passes and the Workflow completes; source `6aae009a4ed56a6aee746c16e2257c2bd1366d84` |

Command failures must throw inside `step.do`, not after a failed exit has been
recorded as a successful cached result. The adapter explicitly defaults command
retries to zero, matching local execution. Workflow error serialization loses custom
class identity, so the adapter restores its own command error code and diagnostics.

The optional example uses `CI.check`: a read-only assertion does not return a new
workspace or trigger a needless snapshot. Its runner uses `standard-1` consistently.
Superseded test instances remain in the native history; no instances were restarted.
Pure Effect action-body policies remain a separate unverified Cloudflare gap, so the
execution-policy matrix row stays `🔜`.

Follow-up edges exposed by these runs: the native cache adapter does not yet
fingerprint `keyFiles` (Vite+/Turbo validate their own task inputs, but custom cache
invalidation still needs work). Snapshot resource-limit failures also occurred in
the superseded optional-check runs. After the live container stopped, retrying only
the snapshot could not recover its uncommitted files. Removing needless check
snapshots fixes this example, not the general checkpoint-failure recovery problem.

Multiple commands in one action now have independent native checkpoints, named from
the logical action ID and command position. Positions include commands reused by the
check-cache layer, so evidence reuse cannot accidentally renumber later operations.
The commands still share the action's working filesystem and publish one final revision.
Deterministic replay restores each result independently, including repeated commands.

`coverage-command-sequence-20261008-1` verified this in the deployed Workflow at source
`7900483beba7180aa09fee4970a054e3bb9b5f4d`: two distinct native command checkpoints,
the second reporting `sequence-verified` after reading the first command's file, followed
by one action workspace commit. The run completed with five native steps. Existing
instances retain their pinned Workflow version; checkpoint naming changes apply to new
instances rather than migrating old histories.
