# From a local check to an approved, observed release

> Can an agent check a commit locally, reuse only that check on Cloudflare, and release the exact tested module after human approval?

This bounded proof uses a dependency-free Worker and the dedicated `effect-ci-hmd-demo`
target. It connects actual CI orchestration, signed Git-note evidence, an inactive
Worker version upload, native Workflow approval and version-attributed HTTP health gates.
The previous allocation is restored after the final gate, including on failure.

The portable program is [workflow.ts](./.cloudflare/ci/workflow.ts). The trusted
host is [FlywheelWorkflow](../../apps/example-runner/src/flywheel-workflow.ts).
It deliberately enrolls only the reviewed fixture bytes, one check and one public key.
Changing a fixture needs host review/reenrollment; project code cannot broaden eligibility.

## Run it

Requires installed dependencies, the existing authenticated Cloudflare installation,
the example host's release-manager binding and an operator-local demo signing key.
The checked-in public enrollment has no private key. This prototype's uploader reads
the existing macOS `cf` OAuth configuration and never sends that credential to the host.

1. Commit the fixture and host. Run `node examples/release-flywheel/scripts/prove.ts local`.
   This executes tests and an ordinary build against committed fixture bytes and
   attaches evidence under `refs/notes/effect-ci-hosted-checks-v1`.
2. Push the source branch, leaving the notes local. Deploy `apps/example-runner`.
   Run `node examples/release-flywheel/scripts/prove.ts verify`: the hosted check
   must execute when its note is absent.
3. Push the notes ref explicitly. Run `verify` again: only `worker-tests` may be
   verified/reused. Preparation, runtime/source measurement and the build still run.
4. Run `node examples/release-flywheel/scripts/prove.ts upload`: upload the exact
   tested module as an **inactive** Worker version and sign its source/version mapping.
5. Run `node examples/release-flywheel/scripts/prove.ts release`. Inspect the native
   `proof:approval-request` checkpoint. A human approves or rejects that exact commit
   and candidate through the authenticated Workflow event API (`flywheel-approval`).
6. On approval, observe 10/25/75/100% promotion, a health gate after each phase and
   exact restoration of the previous allocation. Missing/uncertain evidence cannot
   count as health. Review lasts at most 24 hours and occurs before claiming a release.

`read INSTANCE` stores the native run under `.effect-ci/cache/release-flywheel/`.
`checkpoint INSTANCE NAME` retrieves full native step output when the instance
log truncates it. `scripts/report.ts COLD_ID WARM_ID [RELEASE_ID]` asserts the
saved outcomes and writes an immutable proof manifest.
Private keys and generated candidates are ignored. No notification messages are sent.

## What reuse means here

The signed identity binds repository, full commit, workflow/check/command, host policy,
actual prepared fixture bytes and measured Node/V8 versions. The host independently
reads those bytes and versions. Environment is empty; the reviewed test imports only
its sibling module and Node builtins. OS/architecture are outside this narrow test's
policy; this is not a general cross-platform equivalence claim.

Missing/invalid/revoked evidence or changed inputs runs tests normally. The build
always executes. The separate signed build receipt attests the operator uploaded
those exact bytes as the candidate version; it is developer/agent provenance, not
independent hardware attestation or hosted artifact compilation.

If GitHub's public API cannot supply the note, trusted host code fetches the public
notes ref through the sandbox's existing public Git origin. Only bounded note bytes
leave that container; the host independently verifies the same enrolled signature
and measured inputs. The signer key and API credentials never enter the container.

## Verification proof

**Status:** Local execution, native hosted execution, signed check reuse and signed
candidate binding passed on October 24, 2026 UTC. The release Workflow is paused at
its real human-approval gate. No rollout has started and the complete journey is
not yet claimed.

- [Immutable local/hosted comparison](./proof/cf_19bd874f6ba6f6d0ee4ebae5fc08c1d4cdebf7fa6ac703da37fefb0dffd46613.json)
- [Native approval checkpoint and candidate identity](./proof/approval-pending.json)
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

**Approval and rollout timings:** Pending the actual human decision. CPU consumption
and billed cost were not measured. One observed journey is not a benchmark distribution
or a cost comparison with Dagger.

Health uses closed, version-attributed client HTTP cohorts with conservative confidence
bounds. It does not prove native WOBS ingestion, ambient traffic causality or arbitrary
repository deployment. The target serves dedicated demo traffic only.
