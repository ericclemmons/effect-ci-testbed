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
and deployment policy remain authoritative. #167's general callback boundary
still needs separate implementation and verification.
