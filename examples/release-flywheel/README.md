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

## Verification proof

**Status:** Implementation and local regression proof in progress; no complete hosted
journey is claimed until the native runs and actual human decision are recorded.

**Video:** Pending. No recording has been published.

**Measured results:** Pending. Timings must separate local execution, hosted checks,
evidence lookup, approval wait and rollout. Unknown queue/resource usage is not zero.
One observed journey is not a benchmark distribution or a cost comparison with Dagger.

Health uses closed, version-attributed client HTTP cohorts with conservative confidence
bounds. It does not prove native WOBS ingestion, ambient traffic causality or arbitrary
repository deployment. The target serves dedicated demo traffic only.
