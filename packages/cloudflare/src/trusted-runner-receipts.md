# Trusted runner receipts

Local execution is feedback. Remote execution and SCM CI share the host's check
definitions, runner and receipt authority. Neither trusts a developer's “passed” flag.

A successful pure command produces an Ed25519 receipt binding:

- repository and exact commit;
- workflow, check and command;
- host policy, prepared inputs and runtime;
- originating run, completion time and stdout/stderr digests.

The signature attests to execution. It does not sign Git history, approve a PR,
authorize a deployment or prove that a model's review is correct.

## Execution

`runnerCheckCache` identifies prepared inputs before execution. A valid receipt
for those inputs skips only that pure command. Otherwise the ordinary runner
executes it. Exit code zero and an unchanged post-execution identity permit a
host-only `record` call. Failure, missing identity or a changed input cannot mint
evidence. Storage/signing failure leaves a miss for the next run.

`CheckCache.record(request, result)` receives the actual executor result. Ordinary
actions never enter this path. The identifying callback is part of the trusted
runner: hashing a lockfile supplied by the project is not sufficient.

## Demo authority

`TrustedDemoChecks` holds a dedicated key in private Durable Object storage.
It accepts only the enrolled demo syntax/test commands. No HTTP handler or
workspace binding can submit claims. Its private key is not the GitHub App key
or the old local signer key, and never reaches project code.

The first receipt for an input fingerprint is retained; retries do not replace
its originating run or outputs. The native Workflow's terminal plan includes
public evidence; `--remote --format=json` retrieves that plan from the same
authenticated host. An embedded public key is not independent trust: another
consumer must pin the issuer/key through its own host configuration.

The demo uses a separate unprivileged image derived from the pinned host base.
Node and OS tools remain root-owned. Project commands use a non-login shell;
the inspector requires uid 1000. Other native runners retain their existing
image and shell behavior. A fresh image alone is not sufficient if project
code can replace the inspecting runtime within the same run.

The host uses fresh immutable images and its fixed inspectors. Existing
demo suite constraints remain: changed suite/config/dependency policy causes
execution, not automatic enrollment. Local Git notes are no longer consulted by
this authority. Their standalone verifier and historical evidence remain intact.

## Boundaries

Exact-commit reuse only. Squash/rebase/integration commits require new evidence.
Builds still execute: artifact reuse must restore verified output bytes, not
pretend that a build ran. Deployments and approvals are never cached successes.

The current remote source is a pushed Git commit, not an unpublished checkout.
Receipt storage is a repository-scoped private authority, not yet a general
commit dossier or landing queue. Artifact restoration is separate work.

`@effect-ci-testbed/github/pull-request-review` is the separate org-review adapter:
complete bounded textual diff, tool-free model prompt, strict yes/no result and
a second canonical read before publication. It binds head, base, model and policy.
Stale/incomplete inputs or invalid model output cannot approve. The caller must
supply a budgeted model and journaled GitHub review writer; live webhook wiring
and automatic landing are not implemented by this adapter. Repository policy
must invalidate stale approvals and gate the final integrated commit.
