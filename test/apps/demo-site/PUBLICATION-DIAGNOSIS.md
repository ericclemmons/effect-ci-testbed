# Full immutable preview registry

On October 16, independent source-triggered previews passed their build/check
steps but failed `publish site`. The original generic RPC error and every failed
Workflow remain retained; none was restarted, reset or made green.

The fixed metadata-only diagnostic was deployed from source
`478a84d253903268d05f37a691e10bfa6595bc8f` as site Worker version
`afd1cf7a-1789-46d6-8c27-30d223d25bfd`. Its exact source had 282 successful
checks, three intentional neutral/skipped checks and the two known publication
failure checks. Only this diagnostic rollout admitted that exact retained
failure, to inspect the service responsible for it; this was not an all-green
claim, a merge, an override of GitHub checks or a waiver for unrelated features.

Native Workflow `owned-site-inspection-20261016-1` completed its single
`registry:read-metadata` checkpoint once, with zero retries and empty input:

| Fixed revision | Present | Stored revisions | Original capacity |
| --- | --- | --- | --- |
| Released `105ce02b81915f845df75cbc20ecc383162b54f6` | Yes | 32 | 32 |
| Failed preview `4ae41a23fa6a0978c5f58ec60a135b07fc5addd2` | No | 32 | 32 |

Independent before/after HTTP reads matched all three released asset hashes and
CSP headers. Public inspection remained 404, public POST remained 405, and the
App, released HMD allocation, release manager, repair services/budget broker,
Static Assets target and provider-isolation deployments remained unchanged.
The diagnostic read no asset contents and performed no publication, eviction,
inference, token operation or production release decision.

The local real SQLite/RPC regression then reproduced the failure: the 33rd
revision returned 422. The fix increases the host-owned, still finite retention
policy to 256 without deleting any entry. The regression fills the old capacity,
admits the 33rd, races four requests for the last two slots, rejects over-capacity
and changed-byte writes, and preserves the original receipt across reload.
That regression is local acceptance, not native publication proof.

The capacity fix was then deployed once from source
`08e9058981957a2f25ed3d6fc9e4131dc06019ee` as Worker version
`57e58f82-cada-4808-95d0-89f210cba9e5`, retaining the same three exports,
bindings, public URLs and security behavior. Its exact-source checks had the
same narrowly admitted full-registry publication failure; other checks passed.
All three released asset hashes/CSP and protected deployments again matched.

Native `owned-site-capacity-readback-20261016-1` then completed one metadata-only
checkpoint, once with zero retries: **32 retained records, capacity 256**,
released revision present and failed preview absent. Its Workflow version is
`1e66c0b8-2bcd-4327-868b-4502e7d71ef8`; the original inspection version
`3dcc6cee-2dfa-4625-ba54-011444644419` and 32/32 result remain unchanged.
No old publication was retried, overwritten, evicted or relabeled successful.

[Publication acceptance and current status](https://github.com/ericclemmons/effect-ci-testbed/pull/311)
records the separate ordinary source-triggered preview and independent byte
verification. Metadata readback alone does not prove that publication succeeds.

No old failed publication should be blindly replayed. New ordinary source pushes
must obtain their own immutable receipts; a full registry must not be hidden by
evicting history, changing an operation identity or resetting stored state.
