# Recorded release journey

[Return to the recipe](../README.md). The immutable manifests retain the original
source revisions and deployed host paths. The main-branch integration relocates
the test host under `test/apps`; it does not rewrite these historical receipts.


**Status:** The complete bounded journey passed on October 24, 2026 UTC: local
execution, native hosted verification, signed check reuse, signed candidate binding,
explicitly delegated approval, four progressive health gates and exact restoration.
The operator delegated the approval decision to the agent; the authenticated event
records `actor: agent-on-user-delegation` and binds the checked commit and candidate.

- [Complete asserted journey and native step history](./cf_79311e782345e200e1cda85a4b2eb3719ec810403666f9101c2db82a005f5bfc.json)
- [Independent post-cleanup allocation and health assertion](./restoration.json)
- [Delegated approval receipt](./approval-delegation.json)
- [Earlier local/hosted comparison](./cf_19bd874f6ba6f6d0ee4ebae5fc08c1d4cdebf7fa6ac703da37fefb0dffd46613.json)
- [Historical pre-approval checkpoint](./approval-pending.json)
- Checked source: `724c4f73a48f98faa246e92a3b15c160c65eb3c0`.
- Candidate: `041850ee-aaa0-4a8a-8f39-dd24f4054011`.

| Measurement | Note absent | Signed note reused |
| --- | ---: | ---: |
| Queue | 3.069 s | 0.614 s |
| Verification, including preparation | 18.682 s | 9.710 s |
| Evidence lookup, including source/runtime measurement | 2.589 s | 2.114 s |
| Test command, including dispatch | 0.884 s | Skipped |
| Build command, including dispatch | 0.627 s | 0.576 s |
| Queued to finished | 21.975 s | 10.676 s |

The local journey took 121 ms, including 83 ms for tests. The inactive version upload
took 530 ms, excluding CLI authentication. The successful hosted reuse run has no
native `worker-tests` command, and both runs retain a successful native build command.
The measured source, runtime and policy identities match the local signed envelope.

These are one sample per condition, with different host deployments and uncontrolled
image/startup caches. Only avoiding the test command is established by reuse;
the elapsed-time difference cannot be attributed entirely to that skip. For this
tiny fixture, source/runtime/evidence verification costs more than the test command.

Two earlier lookups after publication missed and correctly executed tests; their
run IDs and snapshot digests remain in the comparison manifest. The release run then
observed a real GitHub API `403` and successfully reused the note through public Git,
pinning notes commit `1cdbb95982a08f3b92c1300b7526280be66ad145`. No API credential
was added to work around the read failure.

**Video:** Pending. No recording has been published.

| Release measurement | Observed result |
| --- | ---: |
| Hosted verification before approval | 11.567 s |
| Native approval wait | 248.273 s |
| Rollout and exact restoration | 469.857 s |
| Observation sleeps within rollout | 240.000 s |
| Complete release Workflow, including queue and approval | 731.891 s |

| Traffic phase | Candidate observations at passing gate | Failures |
| --- | ---: | ---: |
| 10% | 5,167 | 0 |
| 25% | 5,224 | 0 |
| 75% | 5,743 | 0 |
| 100% | 6,000 | 0 |

Every phase first recorded insufficient evidence, waited one minute, collected more
samples and then passed its health gate. Native timestamps supply approval, sleep
and rollout durations. Cleanup deployment `cf23b4e7-3859-441f-8ff5-fcc48e841f06`
restored version `156c4427-b574-49e8-a6c9-cf2d034131b3` at 100%; a separate
deployment read and HTTP request confirmed that allocation and healthy response.

CPU consumption and billed cost were not measured. One observed journey is not a
benchmark distribution or a cost comparison with Dagger.

Health uses closed, version-attributed client HTTP cohorts with conservative confidence
bounds. It does not prove native WOBS ingestion, ambient traffic causality or arbitrary
repository deployment. The target serves dedicated demo traffic only.
