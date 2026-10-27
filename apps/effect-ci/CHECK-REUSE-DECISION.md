# Reuse checks across commits: decision required

Status: proposal for [#229](https://github.com/ericclemmons/effect-ci-testbed/issues/229),
reviewed October 26, 2026. This change documents options; it enables no new reuse,
signer authority, index, deployment, or permission. It does not complete #229 or
the separately owned [#144](https://github.com/ericclemmons/effect-ci-testbed/issues/144).

**Recommendation:** keep exact-commit execution as the default. If Eric approves
a cross-commit policy, first prove content-addressed reuse for one explicitly
enrolled, revision-independent pure check. Treat dependency-selective reuse as a
later optimization of that same verified-input contract, not a shortcut around it.

Thousands of commits can legitimately require thousands of fresh checks. A cache
should remove repeated computations, not impose a target hit rate. New prepared
inputs, dependencies, environment, toolchain, or policy must still execute.

## Verified baseline and guidance

Baseline: fetched `origin/main` at
[`20f29103911800606929de4f9afa095667606e48`](https://github.com/ericclemmons/effect-ci-testbed/tree/20f29103911800606929de4f9afa095667606e48).
All behavior described as current below is landed there. No open PR was returned
by the initial repository-wide PR lookup. This PR adds documentation only; every
new function in the proposal diffs is unimplemented.

Process guidance comes from the repository's `AGENTS.md`, the
[docs authoring guide](../docs/README.md) (Eric Clemmons, October 24), and
[trusted runner boundaries](../../packages/cloudflare/src/trusted-runner-receipts.md)
(Eric Clemmons, October 17). The authoring guide keeps docs beside their owner;
the receipt guide explicitly limits check reuse to an exact commit. The issue
also requires separate approval for broader signer authority. There is no
approved general cross-commit policy in the inspected guidance. These sources
agree: document the decision before changing eligibility.

Implementation prior art is separate from that process guidance:

| Landed source | What it establishes | What it does not establish |
| --- | --- | --- |
| [Runner receipts, October 17](../../packages/cloudflare/src/runner-check-receipt.ts) | Shared remote/SCM adapter, host-only successful-execution claims, before/after identity comparison, exact-identity signature verification | A signature for a different resulting commit |
| [Private authority](./src/trusted-demo-checks.ts) | Fixed repository/check/policy eligibility, dedicated private DO key, immutable first successful receipt per fingerprint | Arbitrary project eligibility, a content index, or a reuse-record issuer |
| [Showcase policy, October 20](./src/showcase-check-policy.ts) and [inspector](./showcase-inspect-check.cjs) | Narrow fixed suite, actual dependency bytes, source restrictions, root-owned inspection, host-version invalidation | Complete inputs for arbitrary tests, all environment variables, or revision-independent execution |
| [Dependency-rerun fixture](../../examples/dependency-aware-reruns/verification/source-rerun.test.ts) | Explicit owned inputs and checkpoints, source/program/runtime invalidation, new execution observations that preserve producer lineage | Deployed general cross-commit check bypass or an enrolled production issuer; its fixture key is ephemeral |
| [Source queries](../../packages/ci/src/source-changes.ts) and [rerun planner](../../packages/ci/src/index.ts#L168) | Bounded committed-path queries; unknown comparisons conservatively match; downstream invalidation through value dependencies | A complete file-read graph, input identity, or proof that an unselected action remains valid at a new commit |

The [retained hosted guide](./TRUSTED-REMOTE.md) records actual same-commit
execute/reuse runs. This inspection did not dispatch runs, inspect current host
allocation, or revalidate those historical proofs. Landed code is not proof of
current deployment. Earlier [PR #339](https://github.com/ericclemmons/effect-ci-testbed/pull/339)
supplies the host-receipt baseline, not cross-merge authorization.

## Who owns the inputs and evidence today

| Boundary | Current owner and limit |
| --- | --- |
| Request and eligibility | Kernel `CheckCacheRequest` carries event, command, workspace and `scope: "commit"`. A project can request reuse, but cannot enroll itself. Host adapters filter exact workflow, step, command, repository, revision and workspace. |
| Prepared inputs | `demoRunnerCheckCache.identify` invokes fixed syntax/test inspectors before and after execution. `showcaseCheckCache.identify` invokes its root-owned inspector. These are host callbacks, not hashes returned by a project script. |
| Source and dependencies | Syntax parses one restricted file without imports; its identity also includes package manifests. Test identities include the fixed suite/config plus actual installed dependency contents, paths and relevant file metadata. A lockfile alone is insufficient. |
| Toolchain and environment | Identities bind inspected Node bytes/version/platform/architecture; the demo adds policy restrictions and the showcase includes host version. Commands use `env -i` with fixed values. This is narrow enrollment, not a general environment-completeness guarantee. |
| Signature and storage | `TrustedDemoChecks` owns the private key and eligibility. It stores `receipt:<revision>:<runnerCheckFingerprint(identity)>`; the fingerprint also includes revision. First success wins. Its `forCommit` check-receipt read is capped at 32 entries, not a historical search or paginated cross-commit index. |
| Acceptance | `verifyRunnerCheckReceipt` compares all nine `HostedCheckIdentity` fields and verifies with host-supplied keys. Copying a receipt/note to another SHA fails. An embedded public key is not enrollment. |
| Kernel result | `CheckCache.lookup` returns only a boolean. A hit omits that command; a miss executes it. `record(request, result)` runs only after success. Non-interruption cache failures fall back through `cacheOrElse`; cancellation still interrupts, and business-command failure never becomes success. |
| Other reuse | `StepResultCache` handles separately signed, exact-commit workspace results. Explicit retained-attempt reruns are another mechanism. Neither grants this proposal authority to skip builds, deployments, migrations, releases or approvals. |

The generic identity has no separate dependency or environment field: adapters
currently fold those constraints into source/toolchain/policy digests. Removing
`revision` from its serialization would change what every existing signature
means. Do not do that. Preserve original signed bytes, signature domains, notes,
receipt keys and producer IDs.

## Options at thousands of commits

| Option | Correctness and trust | Cost and growth | False misses and limits |
| --- | --- | --- | --- |
| **A. Keep commit-bound checks** | Current safe baseline. Different SHA executes even if all relevant content matches. Existing exact-commit hits remain valid only under current host policy. | One direct receipt-key lookup per eligible command after input preparation; no ancestry scan. At least one execution for each new eligible identity. Receipts grow with successful distinct commit/check identities. | Merge, squash, rebase, and unrelated edits miss deliberately. This costs compute but does not weaken provenance. |
| **B. Trusted content/input-addressed reuse** | Host independently computes a complete, versioned computation identity for the actual resulting commit; verifies original execution evidence under current trust; issues a new target-commit reuse record. Only approved pure, revision-independent commands qualify. | Preparation/install/inspection still run. A direct bounded candidate lookup avoids walking thousands of commits. Index entries grow with unique computation identities; new audit records still grow with target commits. | Eviction, publication races, incomplete identity, policy/host rollout, lost or revoked evidence, and bounded lookup limits miss. Rehashing a large dependency tree may cost more than a cheap check. Requires a new approved reuse-assertion policy. |
| **C. Selective dependency invalidation** | B's evidence checks still apply per selected check. Host must prove the complete transitive input graph, including shared configuration and generated inputs. Project path filters or action edges alone cannot justify acceptance. | Can avoid hashing/executing unrelated check inputs once trusted immutable manifests exist. Adds graph construction/versioning, reverse-edge storage and invalidation work; shared changes can invalidate every check. | Conservative over-invalidation is safe. Missing edges cause unsafe hits, not harmless misses. Unknown/dynamic imports, undeclared reads, external state or graph-version changes must invalidate affected scopes, or all checks when scope is unknown. |

Selective invalidation is not an alternative trust model. It is a way to reduce
work after complete identities and evidence verification exist. Start with B only
if the measured avoided command time exceeds preparation, lookup, verification
and provenance-write time. Do not expand from the fixed syntax parser to a whole
suite merely because its current tests happen to pass.

### Scale model, not a benchmark

Let `N` be new commits/day, `C` eligible checks/commit, `D` retained days,
`U` distinct complete computation identities, and `E` dependency-graph edges.
Assume one identity variant per check per commit and one candidate per lookup.
Retries, policy/runtime variants and concurrent runs can add records.

| Work or retained state | A | B | C |
| --- | --- | --- | --- |
| Evaluation opportunities over D days | `N × C × D` | Same; a new commit is still evaluated | Same; graph may reduce inspected scopes |
| Executions | Up to `N × C × D` first executions | Unique eligible inputs plus misses; worst case same as A | Affected/unknown scopes plus misses; worst case same as A |
| Candidate lookup | Direct exact key | Direct computation key, bounded candidates | Per-check computation key after trusted graph invalidation |
| Reuse index | None across commits | `O(U)` until explicitly capped; worst case `U = N × C × D` | Per-check identities plus `O(E)` graph state; worst-case all checks affected |
| Signed audit history | Successful execution receipts | Execution receipts plus target-commit reuse records | Same provenance requirement as B, plus graph/contract version |

For illustration only, `10,000` commits/day × `20` checks × `30` days gives
`6,000,000` evaluation opportunities. At an assumed `2 KiB` per signed audit
record, six million records occupy about `11.4 GiB` before keys, indexes,
replicas, manifests or outputs. These are not this repository's measured traffic,
receipt sizes, enrolled-check count, provider limits or savings. Even if one
computation serves every commit, retaining a target-bound record for each check
does not reduce that audit history to one receipt.

For a bounded B pilot, propose at most one original-execution pointer per
computation key, at most `10,000` live pointers per approved repository/check,
and a `30-day` candidate window. These are reviewable defaults, not implemented
limits or approved retention. Separate audit retention from index eviction.
Removing a pointer causes execution; deleting required audit evidence is not a
cache optimization. An audit archive/retention decision must precede deployment.

At saturation, a policy/host rollout or revocation can turn every lookup into a
miss. Size execution capacity for that case. Put lookup deadlines, queue bounds
and execution fairness under host control; do not let misses trigger unbounded
scans/retries. The current private DO is also a potential hot partition: measure
its latency/write load before proposing sharding, another store, or provisioning.
This PR makes no provider-capacity or paid-resource claim.

## Complete identity for a possible B pilot

The **computation identity** and **commit assertion** have different jobs.
The former may omit a revision only when the approved command cannot observe it;
the latter always binds the actual resulting commit. Equal Git trees alone do
not establish either condition.

| Identity component | Host must compute or enforce |
| --- | --- |
| Domain and trust | Versioned canonical encoding, repository/tenant and issuer-policy scope. No cross-repository or cross-tenant reuse. The index is an untrusted locator, never authorization. |
| Check definition | Workflow, step, exact command/arguments, working directory, executor semantics and pure-check eligibility. No project-selected expected identity or passed verdict. |
| Prepared source | Bytes, paths, modes, relevant symlinks/absence, generated files, submodules/LFS content and allowed read roots actually presented to the command, not just tracked Git blobs. An immutable prepared snapshot or enforced read boundary must prevent concurrent mutation. |
| Dependencies | Actual resolved/installed closure, transitive files, links and relevant metadata, install hooks/config and resolution rules. A trusted immutable dependency manifest may amortize hashing; a lockfile, mtime or package name alone may not. |
| Toolchain | Runtime/compiler/test-runner bytes, flags, image/OS/native-library inputs, architecture and host inspector/executor version. Mutable tags are not complete toolchain identity. |
| Environment | Relevant variable values, locale/timezone, path, user, filesystem/process isolation and any permitted service inputs. Prefer a fixed environment and denied undeclared reads/network. If secrets, clock, randomness, network state or credentials can affect the verdict and cannot be safely identified or excluded, execute without reuse. Do not publish secret hashes or low-entropy commitments. |
| Revision metadata | If the check reads SHA, branch, tags, history, event/PR metadata or version-from-Git, bind those observations or make it ineligible. Same tree with a different observable revision is not a hit. |
| Policy | Eligibility, input inventory, graph/inspector versions, sandbox restrictions and policy validity/freshness requirements. Recheck original and current issuer enrollment/revocation. A TTL is an eviction bound, not evidence that a result remains valid. |

Before/after hashes remain useful, but cannot prove that a command never read
an omitted input or that a concurrent writer did not change and restore bytes.
The future contract needs an enforced input boundary, not merely more hashing.
Current narrow inspectors are prior art to assess, not automatic certification
for that new contract.

Historical v1 receipts do not attest this new complete-input contract. Do not
promote them by dropping their revision or attaching an unsigned manifest. A B
pilot needs a separately signed, versioned source-execution certificate binding
the complete identity/manifest commitment to the immutable original receipt,
source commit/run and approved inspector/policy. Produce it only from an actual
successful execution with complete unchanged before/after inputs. Its issuance
is part of the policy decision, not an extension silently delegated to #144.
An original candidate means that certificate plus the original execution receipt;
both must verify under current trust. Legacy receipts without it cause execution.
Certification must match this actual execution's producer run and output digests.
If the exact store retained a different run's first receipt, do not back-certify
it from the current run's observations; omit candidate publication. Reuse index
availability is optional, so this conservative miss is preferable to invented
historical input coverage.

## Full call diffs

These are architecture sketches, not exported TypeScript APIs. Signatures use
existing names where behavior is unchanged; `+` functions/types do not exist.
The baseline is the full landed flow at `20f2910`, not an earlier draft.

### A: current exact-commit path, unchanged

```text
DemoCIWorkflow / ShowcaseCIWorkflow (trusted host configuration)
  demoRunnerCheckCache(runner, runId, authority): CheckCache
    or showcaseCheckCache(runner, runId, authority, hostVersion?): CheckCache
    runnerCheckCache({ runId, repository, identify, authority, now? }): CheckCache
CI runtime.execute(stepId, workspace, command)
  CheckCache.lookup(request: CheckCacheRequest): Effect<boolean, unknown>
    identify(request, "before"): Promise<HostedCheckIdentity | undefined>
      runner.executor.execute(fixed inspector): Effect<CommandExecutionResult, ...>
    authority.lookup(identity: HostedCheckIdentity): Promise<boolean>
      TrustedDemoChecks.receipt(identity): Promise<string | undefined>
        #eligible(identity); storage.get(exact revision + fingerprint key)
      verifyRunnerCheckReceipt(serialized, expected, keys): Promise<boolean>
  hit -> increment verifiedCommands; return workspace (no new execution claim)
  miss/cache failure -> commandExecutor.execute(request): Effect<CommandExecutionResult, ...>
    failure -> normal command failure; no record
    success -> CheckCache.record(request, result?): Effect<void, unknown>
      identify(request, "after"); compare full before/after fingerprints
      unchanged -> authority.record(claim: RunnerCheckClaim): Promise<void>
        #eligible; signRunnerCheckReceipt(keyId, privateKey, claim)
        transaction: retain first receipt (original run/output digests)
      changed/unknown/record error -> no reusable success; command result retained
host executionEvidence callback -> TrustedDemoChecks.forCommit(revision)
```

### B: proposed opt-in path, only after policy approval

Add a separate host adapter; do not change `runnerCheckCache`, its original
signatures, or the meaning of `RunnerCheckClaim.exitCode: 0`. Exact receipt reads
and newly executed claims stay with the current authority. Candidate publication,
verification and reuse issuance belong to a new private host capability; it
does not expose keys to containers. New record semantics require approval even
if the physical issuer key and repository/check scope stay the same.

```diff
 DemoCIWorkflow / ShowcaseCIWorkflow (trusted host configuration)
-  demoRunnerCheckCache(...) / showcaseCheckCache(...) for the selected pilot
+  crossCommitCheckCache({ exactCache: CheckCache, identifyComplete,
+    authority: ApprovedReuseAuthority }): CheckCache
 CI runtime.execute(stepId, workspace, command)
   CheckCache.lookup(request: CheckCacheRequest): Effect<boolean, unknown>
+    exactCache.lookup(request) -> hit: retain current exact-commit behavior
+    miss -> identifyComplete(request, "before"): Promise<CompleteCheckInputs | undefined>
+      host prepares/freezes actual target inputs; fixed inspector computes identity
+      incomplete/ineligible/unapproved -> false
+    authority.findOriginal(computationKey): Promise<OriginalExecution | undefined>
+      bounded direct index read; no ancestry scan; never accept index verdict
+    authority.verifyOriginal(original, currentInputs): Promise<boolean>
+      verify original receipt and complete-input certificate at original commit
+      current trust/revocation, complete identity and policy compatibility checks
+    authority.issueReuse({ targetRevision, consumerRunId, originalReceiptDigest,
+      computationKey, contractVersion }): Promise<DurableReuseRecord>
+      reconcile idempotent append; bind target and original; preserve original
+    only a verified, durably acknowledged reuse record -> true
+    timeout/invalid/revoked/missing/uncertain write -> false (execute normally)
   hit -> increment verifiedCommands; return workspace
   miss/error -> commandExecutor.execute(request)
     failure -> normal command failure; no success or candidate publication
     success -> CheckCache.record(request, result?)
+      exactCache.record(request, result) -> existing successful-execution authority
+      read/verify immutable exact execution receipt (record returns no receipt)
+      identifyComplete(request, "after"); unchanged + actual successful result ->
+        authority.certifyOriginal(exactReceipt, completeInputs, result): source certificate
+        authority.publishOriginal(certificate, exactReceipt): bounded index pointer
+      missing receipt/changed/incomplete/publication error -> no candidate
 host executionEvidence callback -> TrustedDemoChecks.forCommit(revision)
+  host reuseEvidence callback -> authority.forTarget(revision, cursor?): bounded page
+    independently inspectable target record + immutable original evidence reference
```

Only selection of the pilot adapter moves out of the current workflow cache
factory; ordinary exact-commit execution and signing are not moved. The optional
adapter may repeat inspection on an exact miss initially; measure before trying
to deduplicate it. The proposed reuse capability must validate approved callers,
eligibility and the host-computed observations itself, not trust arbitrary values
merely because they match the sketch's parameter names.

Use a separate versioned `pure-check-reuse` signature domain with a `verified`
outcome. Bind repository, target SHA/run/check, complete computation key and
contract/policy, original receipt digest/issuer/commit/run, decision and issue
time. Preserve the original bytes/signature; never relabel its revision or mint
a `RunnerCheckClaim` claiming this command executed at the target. Output digests
remain the original execution's outputs, not new stdout/stderr. Index only
original executions, not reuse records: bounded one-hop provenance avoids
chains that grow with every commit.

Each successful target lookup needs durable target-bound provenance before it
can return `true`. Use the native run/check/identity to reconcile retries of an
uncertain append. If reconciliation fails, execute normally; a dangling reuse
record must not be reported as a performed bypass. Candidate writes happen
after immutable original receipt publication. Concurrent publication, eviction,
index corruption or archive unavailability cause misses. A valid original found
under the wrong key still cannot authorize reuse.

Per-run input snapshots/leases are owned by the runner and released on hit,
miss, cancellation or failure. An adapter may not delete a producer's retained
evidence/output during cleanup. Cancellation stops the pending decision; an
unobserved background write does not turn cancellation into success.

### C: proposed selective end state, not just the next incremental change

```diff
 DemoCIWorkflow / ShowcaseCIWorkflow (trusted host configuration)
-  demoRunnerCheckCache(...) / showcaseCheckCache(...) for selected checks
+  selectiveCheckCache({ exactCache, identifyGraph, identifyComplete,
+    authority: ApprovedReuseAuthority }): CheckCache
 CI runtime.execute(stepId, workspace, command)
   CheckCache.lookup(request): Effect<boolean, unknown>
+    exactCache.lookup(request) -> hit: retain current exact-commit behavior
+    miss -> identifyGraph(actualTarget): Promise<TrustedInputGraph | undefined>
+      graph includes source/dependencies/config/generated/environment/toolchain/policy
+      choose affected scopes; unknown scope invalidates all checks
+    identifyComplete(request, "before", graph): Promise<CompleteCheckInputs | undefined>
+      validate trusted immutable manifests for all transitive inputs, not changed paths
+    authority.findOriginal(computationKey): bounded original-execution lookup
+    authority.verifyOriginal(original, currentInputs): original receipt + complete-input
+      certificate + current trust + identity/graph contract
+    authority.issueReuse(targetRevision, consumerRunId, original, computationKey,
+      contractVersion, graphVersion): reconcile durable target-bound provenance
+    only acknowledged verified reuse -> true; any uncertainty -> false
   hit -> increment verifiedCommands; return workspace
   miss/error -> commandExecutor.execute(request)
     failure -> normal failure; no evidence/candidate
     success -> CheckCache.record(request, result?)
+      exactCache.record(request, result); inspect complete post-execution inputs
+      read/verify immutable exact receipt; unchanged + actual successful result ->
+        authority.certifyOriginal(exactReceipt, completeInputs, result, graphVersion)
+        authority.publishOriginal(certificate, exactReceipt): bounded index pointer
+      failure/changed/unknown -> no candidate; normal execution result retained
 host executionEvidence callback -> TrustedDemoChecks.forCommit(revision)
+  host reuseEvidence callback -> authority.forTarget(revision, cursor?): bounded page
+  runner finalization -> release per-run graph/snapshot leases on every exit
```

The graph service is a new trusted input-inventory owner. Nothing moves into
project-provided file filters. Unaffected scopes still need identity/evidence
validation and a new target record. `planRerun(plan, requested)` remains the
existing value-consumer selector; it does not become a cross-commit verifier.
Its action dependency edges are not a source dependency graph. The current
explicit retained-attempt rerun mode keeps its normal semantics and forced
recomputation; this proposal does not silently override it.

## Acceptance gates for any later implementation

These are required future evidence, not tests added or results obtained by this
PR. Keep normal execution on every miss; keep #144's baseline work separate.
In every proposed path, run cancellation/interruption still propagates; only a
bounded cache failure falls back to execution while that run remains active.

| Case | Required outcome |
| --- | --- |
| Merge, squash and rebase with equal complete inputs under approved revision-independent policy | Reuse eligible pure check only; preserve original assertion; issue new resulting-SHA provenance |
| Updated main/base, conflict resolution, source/dependency/config/generated-input change | Execute affected checks; unrelated checks only reuse after independent complete identity verification |
| Equal tree but revision-sensitive command, changed environment/toolchain/policy/graph or unenrolled inputs | Execute; no SHA stripping, ancestry inference or changed-file-list acceptance |
| Missing/malformed/tampered original, wrong repository/command/check/commit, unknown/revoked issuer, ambiguous provenance | Execute; no implicit key enrollment or fallback to advisory notes |
| Index unavailable/stale/evicted/oversized, immutable evidence unavailable, timeout, uncertain append, concurrent publication or cancellation | Bounded failure handling and ordinary execution where still requested; no false success, unbounded lookup or original-evidence deletion |
| Dirty checkout, ordinary action, consumed-artifact build, deployment, migration, release or approval | No authority from this cache; retain ordinary execution and separate artifact/action policies |
| New target record inspected independently | Original bytes verify at original SHA; new reuse-domain record verifies at target SHA and names the original; no false execution claim |
| Hosted execute/reuse/changed-input negative plus conventional comparison | Record source and resulting commits, host version, identities, trust scope, outcome/reason, lookup/inspect/execute/write timing and total latency; distinguish mocks/local results |
| Sustained unique inputs, rollout/revocation misses and index saturation | Measure execution fallback capacity, bounded lookup latency, storage/index growth, eviction misses and audit retention; do not claim savings from hit counts alone |

## Validation of this documentation change

All 29 existing tests in `scripts/check-recipe-docs.test.ts`,
`packages/cloudflare/src/runner-check-receipt.test.ts`,
`packages/cloudflare/src/check-cache.test.ts` and
`packages/ci/src/cache-outages.test.ts` passed locally. They confirm the current
exact-input/fallback/cancellation boundaries and documentation conventions, not
the proposed cross-commit paths. No tests or runtime code changed.

The configured docs build, route/link/source-snippet verifier and build-output
generator passed using their installed Node entrypoints; the verifier checked
91 collocated-document routes, including this decision page. The `pnpm` script
wrapper stalled without diagnostics and was stopped before running those same
build tools directly. `git diff --check` passed. No hosted run or pipeline was
dispatched or watched.

**Decision for Eric:** retain A, or explicitly authorize a narrowly scoped B pilot
and its new reuse-assertion semantics, enforced input boundary, candidate limits
and audit-retention policy. C needs a separate input-graph contract and evidence.
Until that choice is made, this draft intentionally stops at the decision
artifact. No complete cache, standalone cross-merge demo or hosted acceptance is
claimed.
