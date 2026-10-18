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

The demo uses a separate unprivileged image built from a pinned public Node base.
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
Deployments and approvals are never cached successes.

## Durable step results

`StepResultCache` is a host adapter at the completed-step boundary. Lookup happens
before action construction, so an eligible hit can return the saved result
without recreating its prerequisites. Record happens after successful execution
and workspace commit. Planning never reads/writes this store. Provider failures
miss; failed execution or commit cannot record a success. Rollback-bearing actions
keep their normal lifecycle rather than entering this cache.

The demo enrolls only its fixed zero-argument build as reusable computation.
Its separately signed step receipt binds repository, commit, workflow, step,
host policy/runtime and the returned immutable workspace snapshot. It does not
infer eligibility from an arbitrary project's action name. Additional dynamic
inputs, arguments, secrets or side effects require a different host enrollment.
The runtime identity includes Cloudflare's Worker version metadata: a host/image
rollout invalidates prior build reuse. Missing version metadata disables this
optimization rather than guessing an identity.

A later run verifies the receipt, checks snapshot availability, and hydrates a
Workspace with the receiving run's owner—not the producer's workspace ID. The
publisher reads the saved build files through that workspace. No separate
publish/upload/restore calls are added to the user's workflow.

An unavailable snapshot is a durable miss without provider-read retries. A
successful rebuild records a new result while retaining prior run receipts.
Replaying an older producing run cannot move the latest pointer backwards.

The kernel result contract also permits other return values, such as R2-backed
recording handles. The demo adapter currently serializes workspaces only; it does
not upload videos or claim a generic artifact codec. Storage backing belongs to
the provider, not a new user-facing workflow concept.

The current remote source is a pushed Git commit, not an unpublished checkout.
Receipt storage is a repository-scoped private authority, not yet a general
commit dossier or landing queue.

`@effect-ci-testbed/github/pull-request-review` is the separate org-review adapter:
complete bounded textual diff, tool-free model prompt, strict yes/no result and
a second canonical read before publication. It binds head, base, model and policy.
Stale/incomplete inputs or invalid model output cannot approve. The caller must
supply a budgeted model and journaled GitHub review writer; live webhook wiring
and automatic landing are not implemented by this adapter. Repository policy
must invalidate stale approvals and gate the final integrated commit.

Ordinary Markdown-only changes take a deterministic documentation policy with
`model: "none"`; no agent or paid call is needed. Renames, automation paths,
agent instructions and security/policy files stay outside that fast path.
Code changes without a configured reviewer require review, not automatic approval.
