# Signed-check evidence and comparison boundaries

[Issue #144](https://github.com/ericclemmons/effect-ci-testbed/issues/144) remains
open. The verifier, normal execution on misses, host-only signing and hosted
developer-loop composition already have retained proof. The remaining work is
the conventional GitHub comparison and this recipe's exact-environment Cloudflare
comparison, not rebuilding those capabilities.

Source baseline: `20f29103911800606929de4f9afa095667606e48` on `main`.
This inventory separates historical execution from current deployment state.
It does not grant execution authority or authorize a cache hit.

## Coverage by environment

| Cell | Retained evidence | Boundary |
| --- | --- | --- |
| Conventional GitHub Actions | [Standalone YAML](./.github/workflows/github.yml) runs `node --check app/index.js` without a proof store. | Not in the baseline's conventional comparison matrix; no retained native comparison run is established here. Keep 🔜. |
| Effect CI Local | Existing [recipe assertions](./.cloudflare/ci/tests/verification-evidence.test.ts) cover clean-commit reuse and dirty-input refusal. | The assertions use a fake executor. They are contract tests, not hosted command or performance proof. |
| Effect CI GitHub | Baseline [execute job](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/40149142030/job/121036769883) passed. A separate [signed-note job](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/40149142030/job/121036768534) recorded `complete` then `verified`. | The signed-note job invokes the local CLI on a GitHub-hosted Ubuntu runner. Its fresh ephemeral signer and local note do not establish Cloudflare enrollment, public-note transport or invalid-evidence fallback. |
| Effect CI Cloudflare | [Seven historical native cases](../../apps/effect-ci/src/live-demo-signed-check.test.ts) and [host-issued receipt acceptance](../../apps/effect-ci/TRUSTED-REMOTE.md) establish scoped native reuse. | These use the demo host's program, not this recipe's standalone workflow. Keep this recipe's 🔜; do not relabel a different program's proof. |
| Hosted developer-loop composition | [October 24 release-flywheel journey](../release-flywheel/proof/README.md) records local checks, native execute/reuse, approval, health gates and restoration. | Composition exists. It does not fill either missing comparison cell. |

The [baseline recipe run](https://github.com/ericclemmons/effect-ci-testbed/actions/runs/40149142030)
failed overall. Its successful individual jobs above are not a full-suite pass.
The comparison matrix runs other conventional recipes through `act`; running a
workflow under `act` is not evidence of that workflow's native GitHub execution.

## Retained identities and timing

### GitHub execute and reuse

[Sanitized job metadata and original CLI results](./verification/github-40149142030.json)
retain the full source SHA, run/attempt/job IDs, runner image, log SHA-256 and
both CLI results. Source and workflow host code came from the same baseline
commit. Runner image: `ubuntu-24.04`, version `20261012.334.1`.

The job ran on October 25, 2026 UTC, from `01:11:34Z` to `01:11:57Z` (23 s).
Its combined record/reuse step spans `01:11:53Z` to `01:11:54Z` (1 s at the job
API's whole-second precision). That step includes key generation, signing and
both CLI invocations. Separate execute, reuse, fallback and queue durations were
not recorded. Do not subtract log-print timestamps to invent those measurements.
The second result's planned command remains visible even though its status is
`verified`; a command in the plan is not an execution audit.

### Native Cloudflare composition

The [original manifest](../release-flywheel/proof/cf_79311e782345e200e1cda85a4b2eb3719ec810403666f9101c2db82a005f5bfc.json)
retains source `724c4f73a48f98faa246e92a3b15c160c65eb3c0` and host source
`2d89094e3607367e6406ae111e6830a570468aca`. They differ from the inventory
baseline and must not be rewritten as runs of current `main`.

| Native case | Instance | Queue | Verification including preparation | Evidence lookup | Test command including dispatch | Build command including dispatch |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Note absent; execute | `cf_c2c1dae92881fa69abdeac367878fd88a6927db10a380b4124ae22abbc677660` | 3.069 s | 18.682 s | 2.589 s | 0.884 s | 0.627 s |
| Signed note accepted; reuse | `cf_19bd874f6ba6f6d0ee4ebae5fc08c1d4cdebf7fa6ac703da37fefb0dffd46613` | 0.614 s | 9.710 s | 2.114 s | Skipped | 0.576 s |

The manifest retains different cold/warm Worker versions and uncontrolled startup
caches. These are single samples, not a controlled speedup or CPU/billing estimate.
Evidence lookup is part of verification, not an extra duration to add to it.
The release's GitHub API `403` followed by verified public-Git retrieval is a
transport fallback that still reused the check. It is not an invalid-proof
execution fallback. Earlier retrieval misses and all original receipts remain
unchanged; no missing fallback timings are inferred from them.

## Acceptance status

| #144 criterion | Evidence or remaining work |
| --- | --- |
| Commit before reusable proof; dirty-tree feedback is separate | [Release-flywheel instructions](../release-flywheel/README.md#run-it) specify commit, exact-input check/sign, separate source/note pushes and fixed host enrollment. |
| Reuse only exact, enrolled pure checks | [Trusted remote acceptance](../../apps/effect-ci/TRUSTED-REMOTE.md) records same-commit producer/reuser identities; builds use a separate signed-output contract, not a pure-check exemption. |
| Missing/invalid evidence executes normally | [Retained acceptance reader](../../apps/effect-ci/src/live-demo-signed-check.test.ts) pins source `b22f6cfc30b7feb480cb25e30a86576a431276cb` and seven native instance IDs for absent, valid, invalid-signature, wrong-commit, changed-input, changed-policy and unknown-key cases. It is a reader, not a new execution in this inventory. |
| No container signer or advisory-note authority | Historical Git-note signing stays operator-local; the newer [receipt integration](../../apps/effect-ci/src/demo-runner-check-cache.ts) reads host-issued receipts. Private signing stays in the host DO. |
| Remaining comparisons and hosted composition | Composition is retained above. Conventional GitHub and the exact recipe's Cloudflare comparisons still need authorized recorded runs. |

Cross-merge reuse remains [#229](https://github.com/ericclemmons/effect-ci-testbed/issues/229).
Do not copy an old signature onto a merge SHA or remove a signed identity field.

## Authority needed before new comparison runs

The current worktree has no authenticated `cf` CLI session. The connected
Cloudflare API account list did not include the account in the historical demo
links. No account substitution, credential extraction, login, deployment,
dispatch, signer enrollment or note publication was attempted.

The baseline [example host](../../test/apps/example-runner/src/worker.ts) exports
the release-flywheel program but does not enroll this recipe. A working account
session alone would not make its Cloudflare comparison executable.

Requested authority, not an approved plan: one native GitHub baseline job and at
most three Cloudflare check-only instances (execute, valid reuse, invalid-evidence
fallback), each capped at ten minutes with no automatic retries. Name the existing
Cloudflare account/host allowed to run this exact recipe and approve a spending
cap before any dispatch. Scoped access must allow reading retained histories and
starting only those checks. Conventional GitHub should execute the
unchanged baseline command on a native runner; Cloudflare must retain exact source,
host version, prepared-input/policy identities, and execute/reuse/fallback results.
Record queue, preparation, lookup and command times separately, or mark them
unmeasured. Any needed host-program change or new trust enrollment requires a
separate explicit approval; this inventory does not authorize it.

No candidate upload, build-output bypass, deployment, release approval, production
change, paid reviewer or new signing authority is needed or permitted by this request.
