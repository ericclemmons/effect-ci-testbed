# Native bounded provider isolation

Exact tested source: `9d2767da9426700e3f9b4eed7f05603d25d82a81` (284 successful
checks; three intentional neutral/skipped). One guarded deployment created the
private `effect-ci-provider-isolation` Worker/Workflow and `DeliveryJournal`
SQLite class. Version: `f1afbab9-a7d7-4d8f-94c8-81ef2c38320e`; Workflow ID:
`6df35a11-c53b-4527-a7a0-de8634861b32`. Independent version readback found no
public URLs and only the version-metadata binding. Build: 71 modules, 169.64 kB;
upload: 165.67 KiB, gzip 38.48 KiB; reported startup: 12 ms, not a benchmark.

Each case was created once on October 16, 2026, with an exact fixed mode. No
external notification was posted. The rejecting destination is actual private
Worker RPC; the healthy destination is an owned SQLite message updated via RPC.

| Retained instance | Business outcome | Healthy updates | Rejecting invocations |
| --- | --- | --- | --- |
| `owned-provider-success-20261016-1` | Success | 5 | 1 |
| `owned-provider-business-failure-20261016-1` | Original business failure | 4 | 1 |
| `owned-provider-provider-timeout-20261016-1` | Success | 5 | 1 |

All native steps have one attempt and zero retries. The business-failure run
remains **errored**, with `Original owned business failure`; it was not reset or
made green. The timeout run retains the failed `provider:rejecting:1-1`
checkpoint, while its separate delivery-status receipts, business result and
terminal SQLite view independently show continued execution. A complete outer
status is not a claim that every provider delivered. All returned delivery
failures omit upstream error text. Later events did not invoke the failed
destination again. Each final message binds the original instance and actual
Worker version, not a copied commit signature.

Before native faults, independent readback confirmed the existing repair
automation remained service-scoped to **only** `effect-ci-repair-incident`;
the separately pinned public repair enrollment does not admit this fixture.
No account-wide policy, permission, secret, production target, AI ledger,
repair operation, external destination or existing journal was changed. No
model call or repair PR was created. Normal compute/storage remains metered.

## Read the proof without replaying it

From this directory:

```sh
LIVE_NOTIFICATION_ISOLATION=1 CF_BIN=../effect-ci/node_modules/.bin/cf node --test src/live.test.ts
```

This reads only the existing three histories and deployed version. Ordinary CI
skips the native reads and runs the actual local runtime/SQLite/RPC suite. Do not
repeat the create commands, redeploy, restart or reset the instances for proof.

This proves the standalone bounded delivery recipe, not a real Slack/GitHub
outage, general arbitrary runtime callbacks, missing-review acceptance, full
incident healing or automatic rollback. Required persistence, approval checks
and deployment policy remain authoritative. The general callback boundary now has
the separate implementation and native campaign below; dedicated HMD
review-delivery policy remains an explicit #167 audit, not a missing-review approval.

## Native generic runtime observers

Exact source `335413fa6f958f9d7a5b3360abaafa0c511b2150` passed 284 checks plus
the same three intentional results. One guarded update of this existing private
fixture produced Worker version `b9589e8e-abd8-4041-94f3-277adadbf0ab` and Workflow
version `66191594-d09e-435b-867c-767556b0c74f`. The Worker retained the same three
exports, version-metadata-only binding, disabled public URLs and SQLite namespace.
Build: 72 modules, 173.02 kB. This added no resource, secret, permission, model call,
public error source or repair enrollment. Nine protected deployments, the newly
committed Vite release and the service-only repair automation remained unchanged.

| Retained instance | Outcome | Generic healthy / provider healthy updates | Total journal updates |
| --- | --- | --- | --- |
| `owned-observer-success-20261016-1` | Complete | 5 / 5 | 10 |
| `owned-observer-business-failure-20261016-1` | Errored, original business cause | 4 / 4 | 8 |

Each case was created once after a create-only intent. Both the generic observer
and provider layer called their rejecting loopback RPC destination once each,
then quarantined that destination. The independent healthy SQLite observer and
provider both continued through the terminal business event. Thus there are two
intentional rejecting RPCs per run, not one shared call or a claimed zero-error run.

`observer-status` retains 10 / 8 bounded redacted receipts respectively, with no
dropped events or omitted receipts. Its rejecting sequence is `failed`, then
`blocked`; every healthy observer receipt is `delivered`. Reports, business result,
invocation counts and final owned SQLite view are separate native checkpoints.
All checkpoints succeeded once with zero retries; the original business failure
remains an errored Workflow, never a green failure fixture. The old three histories
were re-read after this update and retained their original outcomes and identities.

From the repository root:

```sh
LIVE_RUNTIME_OBSERVERS=1 CF_BIN=cf node --test test/apps/notification-isolation/src/observer-live.test.ts
```

The three GET-only checks verify both retained histories and the exact private
Worker metadata. Ordinary CI skips these live reads. Synthetic invalid-history
reader regressions are labelled synthetic, not native evidence. Generic timeout,
synchronous throw, business retry/rollback and required persistence/approval
failure behavior are separately tested locally; these two native cases establish
real RPC rejection and healthy SQLite continuation, not a native timeout or an HMD
review-delivery outage. No old run was restarted, overwritten, deleted or relabelled.
