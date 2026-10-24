# From a local check to an approved, observed release

> Can an agent check a commit locally, reuse only that check on Cloudflare, and release the exact tested module after explicit approval?

This bounded proof uses a dependency-free Worker and the dedicated `effect-ci-hmd-demo`
target. It connects actual CI orchestration, signed Git-note evidence, an inactive
Worker version upload, native Workflow approval and version-attributed HTTP health gates.
The previous allocation is restored after the final gate, including on failure.

[Portable check and build](./.cloudflare/ci/workflow.ts "source")

[Trusted hosted Workflow](../../test/apps/example-runner/src/flywheel-workflow.ts#symbol=FlywheelWorkflow "source")

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
2. Push the source branch, leaving the notes local. Deploy `test/apps/example-runner`.
   Run `node examples/release-flywheel/scripts/prove.ts verify`: the hosted check
   must execute when its note is absent.
3. Push the notes ref explicitly. Run `verify` again: only `worker-tests` may be
   verified/reused. Preparation, runtime/source measurement and the build still run.
4. Run `node examples/release-flywheel/scripts/prove.ts upload`: upload the exact
   tested module as an **inactive** Worker version and sign its source/version mapping.
5. Run `node examples/release-flywheel/scripts/prove.ts release`. Inspect the native
   `proof:approval-request` checkpoint. The operator, or an agent explicitly delegated
   that decision, approves or rejects the exact commit and candidate through the
   authenticated Workflow event API (`flywheel-approval`). Record who decided.
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

## Recorded results

The [complete recorded journey](./proof/README.md) passed local and hosted checks,
reused signed evidence, accepted explicitly delegated approval, passed all four
health gates and restored the original allocation. CPU usage and billed cost were
not measured; the timings are single samples with uncontrolled startup caches.

The receipt validator in `scripts/report.ts` checks saved native outputs. The recorded
proof predates the host-directory move; the integration preserves those original
receipts and verifies the relocated code separately. See the audit for exact source,
runtime, approval, deployment and timing identities.
