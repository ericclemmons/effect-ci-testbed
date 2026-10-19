# Propose one verified demo repair

`proposeRepair` is a **host-only writer primitive**, not an unrestricted coding
agent or a deployed RPC endpoint. It fixes only the owned health-status fixture:

| Boundary | Fixed policy |
| --- | --- |
| GitHub App / installation | Existing App `5089816` / installation `165265172` |
| Repository | `ericclemmons/effect-ci-private-github-fixture` |
| PR base | `demo/friday-repair` — never `main` |
| Allowed edit | `repair-demo/health.js`, regular file, mode `100644` |
| Source | `healthStatus()` returning the literal `500` |
| Candidate | Only the same zero-argument function returning literal `200` |
| Verification | Host-owned exact-commit `node --test repair-demo/health.test.mjs` |
| Writes | One owned `codex/repair-RUN` branch and proposed PR; no overwrite/merge/deploy |

Model text is capped at 1 KiB. An optional single JavaScript code fence is accepted;
extra explanation, imports, tools, commands, expressions and other functions are
rejected. Accepted output becomes one canonical source string. **Nothing from the
model is evaluated by this writer.** This is intentionally a narrow demonstration,
not a claim that arbitrary repairs are safe.

## How it works

1. Validate the run, full base commit and allowed candidate before minting a token.
2. Mint only **Contents: write + Pull requests: write** for the one private fixture.
   The existing parent App credential remains broader; never give it to project
   code, containers, models or callers. The writer token is revoked on success
   and failure. Ordinary CI reporting/checkout keep their separate read-only scopes.
3. Require the dedicated base branch still to match the expected commit. Read
   actual Git tree/blob bytes; verify Git object hashes, regular-file mode and
   the exact owned failing source. Reject symlinks, submodules, malformed,
   duplicate or truncated trees. Hash the expected replacement tree locally,
   preserving every other object; a replay branch must match that exact tree,
   parent and owned commit message.
4. Create a fix commit and create-only branch, then call the **trusted host
   verifier** on that exact commit. A failed, stale or mismatched receipt produces
   no PR. An owned branch may remain for inspection; it is not silently deleted.
5. Re-check both refs and create a PR only after verification. Replays find the
   same owned App PR and exact commit/patch identity. A foreign, closed or
   ambiguous PR is not reused, overwritten or duplicated.

Every request goes to a fixed GitHub API origin, rejects redirects, bounds response
bytes and has a ten-second transport deadline. Errors omit server bodies,
credentials, proposed text and verifier exceptions. A lost write acknowledgement
fails rather than blindly retrying; a later explicit invocation reconciles its
owned branch/PR. GitHub does not provide an atomic transaction across all these
operations: checks detect observed ref drift, not every possible concurrent write.
Proposed PRs still require review.

```ts
// Trusted host module only. This callback is NOT supplied by the model or RPC caller.
const proposal = await proposeRepair(credentials, {
  runId: incident.runId,
  baseCommit: incident.hostPinnedBaseCommit,
  proposedText: untrustedModelReply,
}, async input => hostVerifier.verifyExactCommit(input))
```

The verifier must actually run the fixed check on bytes from the bound commit and
return its commit/source digest and persisted receipt identity. A regex match,
caller-provided `passed: true`, cached unrelated result or advisory Git note is not
verification. The receipt is **not** signed reusable cache authorization or hardware
attestation. Never relabel a Dynamic Worker assertion as a Node command it did not
execute.

## Current evidence and remaining integration

Nine unit tests use **mock GitHub replies** to cover exact scope, verification
ordering, one-file tree identity, drift, foreign PRs, unsafe model output, token
revocation and lost-response replay. Tree hashing is compared to independent
`git hash-object`; that command does not write Git objects. No GitHub repository
mutation, native writer, Flue agent, actual verifier or proposed repair PR is
claimed by these tests. Separately, the
[operator proof](../../test/apps/repair-ai/scripts/README.md) created a real one-file
private PR after a local exact-commit check; it records source, timings and
boundaries rather than relabeling that replay as hosted Flue execution.

The dedicated failing branch and local verifier are now exercised by that operator
proof, preserving private `main`. A host RPC boundary, genuine hosted
successful/denied/replay E2E, Workers Issues delivery and the budgeted Flue agent
remain separate slices. Video and measured full end-to-end repair timings are not
yet recorded. Track implementation in
[#159](https://github.com/ericclemmons/effect-ci-testbed/issues/159).

## Native Node verifier boundary

`verifyOwnedRepair` is the separately scoped host verifier. It accepts only a full
candidate commit and owned run ID. Before execution it pins the dedicated base,
candidate ref, single parent and writer message, then fetches all three files at
that exact commit. The health source, test and package manifest must match the
host's fixed bytes and Git blob hashes; changed tests, symlinks and other source
are rejected. This is deliberately not arbitrary project verification.

The existing App host exports a private `RepairVerifier` capability. Its trusted
implementation materializes only those three already-validated files into an
owned `WorkspaceContainer`, then actually executes:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin node --test repair-demo/health.test.mjs
```

No checkout token, App credential, installation token, model command, install
script or other repository file enters the container. Successful execution
publishes an owned exact-commit native Node check using a separate private-fixture
**Contents: read + Checks: write** token, revoked on success or failure. Check
identity and refs are checked again before returning the verifier receipt. Raw
container/API output is not published. A check may exist after late ref drift,
but the rejected receipt cannot authorize a PR.

The authenticated `effect-ci-owned-repair-verification` Workflow has a fixed
`verify-retained` pilot mode for the already-existing private fixture PR1 commit.
It uses one checkpoint with zero retries and performs no code/PR/merge/deploy
writes. Nothing adds a public repair route or gives the model this capability.

Eight tests use mocked GitHub responses and real **local** Node execution for the
positive fixture; they cover token separation/revocation, changed bytes, symlinks,
truncated/tampered Git trees, execution failure, foreign checks, ref drift and
replay without duplicate checks. A separate actual local workerd Workflow/RPC/DO
test checks serialization, rejected content and private fetch 404 with **fake**
GitHub and container execution. It does not relabel fake execution as native Node.
The first real native verification is recorded below. The existing private PR1
still originated as a local operator replay, not an incident-driven repair.
Native denied/replay evidence, writer integration and real Workers Issues
delivery remain required before claiming the live flywheel is complete.

### Recorded native Node verification

Merged source `ee5444614ee070a1530bb84c52f152a36278d7c2` was rebuilt and deployed
once to the existing App Worker, version `d625ce13-4c21-4234-a095-c916812b9b69`.
The existing Docker image and all prior exports/bindings were retained; no new
secret was required. Root Access still returned 302 and unsigned GitHub/Slack
callbacks still returned 401 before and after. No HMD review was running or
waiting, and no new HMD, Slack message or fixture deployment was initiated.

`coverage-owned-native-verifier-20261014-1` completed its one checkpoint with one
attempt and zero retries. Actual native container Node execution checked the
three host-pinned files fetched from commit
`bd9682e5b9ca5f8f696ea8052bd5afd4cd2c0a00`, then published App-owned check
`115744830965`. An independent GitHub read confirmed App `5089816`, exact head,
external identity, completed status and **SUCCESS**. The complete native receipt
is retained privately in `/private/tmp/effect-ci-owned-node-verifier-20261014-receipt.json`;
it is not uploaded or reusable cache authorization.

Observed queue **3,708 ms**, native execution **5,171 ms**, total **8,879 ms**,
one sample on October 14, 2026 UTC. These include GitHub API operations, container
preparation and check publication; they are not isolated Node test latency or a
full repair benchmark. No raw container output was published. The scoped verifier
token was revoked before the completed Workflow returned.

This verifies native exact-commit Node execution, not native writer/PR creation,
real Workers Issues delivery or the complete Flue-to-PR ordering. Private `main`
remained `ecf13c17597b2718e44509e8850eba1b0b15866d`, PR1 stayed open at the same
head, and no inference was called. The lifetime AI ledger remains four historical
calls, $0.40 reserved and $6.60 remaining authorization, not measured billing.

```sh
CF_BIN=/Users/eric/Library/pnpm/bin/cf \
LIVE_NATIVE_REPAIR_INSTANCE=coverage-owned-native-verifier-20261014-1 \
node --test apps/effect-ci/src/live-repair-verifier.test.ts
```

This opt-in regression reads retained native history and the owned GitHub check
only. Ordinary CI skips it; it cannot deploy, redispatch, spend inference or write
GitHub. Local fake-service tests remain separate from this native proof.

## Retained-proposal native writer pilot (verified natively)

The private generated Flue host now exports a **read-only**
`RecordedProposalEvidence` capability. It reads its own fixed completed native
Workflow and independently checks the durable broker's retained reservation/run
identity. It exposes only the recorded instance, reservation, run and bounded
canonical text. No agent dispatch or model call is made by reading that evidence.
The Flue host still receives no App credential or GitHub mutation capability.

The existing App host's private `RepairWriter` uses one fixed operation and run:
`friday-native-repair-20261014-1`. Callers cannot choose a repository, base, file,
patch, command, verifier, model prompt or fresh operation ID. The dedicated
`OwnedRepairOperations` SQLite-backed DO persists the pending request identity
**before** invoking the scoped writer. The proven native verifier runs on the new
exact candidate commit **before** any proposed PR. Writer and verifier tokens
remain separate and host-only, and are revoked finally.

A completed result is persisted before acknowledgement. Replays return that
historical receipt with `replay: true` and `created: false`, without another
evidence read, model call, Git write or verification. It is not a current PR-state
assertion, approval or permission to merge/deploy. Pending, failed, corrupt or
mismatched records fail closed: there is no automatic fresh operation, storage
reset or retry. An owned branch/PR may remain after a lost acknowledgement; inspect
both durable state and GitHub before explicitly designing recovery. Nothing is
silently deleted or overwritten.

The authenticated `effect-ci-owned-repair-proposal` Workflow accepts only one
mode field: `inspect` (read operation state), `inspect-evidence` (read retained
native proof), or `propose-retained` (the fixed writer pilot). Every checkpoint has
zero retries. There is no public writer route, automatic merge, deployment or
Workers Issues trigger here. This pilot is explicitly **administrative composition
of real retained Flue evidence**, not a fresh incident-driven repair.

Eight new pure tests cover evidence identity/ledger mismatch/accessors, concurrent
admission, failure/uncertainty, completion-ACK loss, corrupt state and completed
replay. Actual local workerd Workflow/RPC/SQLite tests exercise the coordinator,
result serialization and restart without further calls using **fake GitHub and
fake verification**; another local RPC test reads a real local Workflow carrying
**fake historical contents** plus a separate fake broker. None of those tests is
native writer or real Flue proof. The actual native pilot is recorded below;
authentic Workers Issues delivery and the complete ordered live flywheel remain
separate.

### Recorded native proposed PR and replay

Merged source `37ccda5045368b5576afc426d85169e78a01ed1d` built and deployed both
private capabilities once: App Worker `fa320ac8-a1bd-48d9-b6e7-24639715a4c7`
and Flue evidence host `92e6cfb8-4344-4141-9cb4-dfffc72ed800`. No App key or
writer binding reached the Flue host; no new secret, model authority, Access
policy or HMD approval was introduced. Protected root/unsigned callbacks kept
their previous 302/401/401 statuses.

Read-only native `coverage-native-writer-evidence-20261014-1` validated the
retained real Flue tuple against its actual Workflow and independent ledger.
`coverage-native-writer-inspect-20261014-1` confirmed the operation was absent.
Then **one** `coverage-native-repair-proposal-20261014-1` completed its single
checkpoint once, with zero retries. It created
[private proposed PR2](https://github.com/ericclemmons/effect-ci-private-github-fixture/pull/2)
as `effect-ci-testbed[bot]`: only `repair-demo/health.js`, literal 500 → 200.
Exact head `08b74a4688844a26be097ea28f9706c7a7b35a79` passed actual native
Node check `115785356860` at 09:39:42 UTC **before** PR creation at 09:39:43 UTC.
Independent GitHub reads confirmed App `5089816`, head/check identity, SUCCESS,
the one-file patch and open/unmerged state. Private `main`, base and PR1 were
preserved. Neither repair PR was merged or deployed.

Completed native `coverage-native-repair-replay-20261014-1` returned the same
commit/check/PR with `created: false`, `replay: true`; its own checkpoint reads
the persisted result, without another evidence/model/Git/verification call.
This proves native persisted-result replay, not forced native process restart
or reusable CI-check attestation. The saved receipt is not current PR status.

| Native administrative run | Queue | Execution | Total |
| --- | ---: | ---: | ---: |
| Proposed PR | 646 ms | 11,933 ms | 12,579 ms |
| Completed-result replay | 2,094 ms | 151 ms | 2,245 ms |

One sample each on October 14, 2026 UTC. The writer consumes the **earlier**
04:13 UTC Flue proposal; these timings exclude that model run and are not a fresh
incident-to-PR benchmark. This is genuine native administrative composition,
**not** a Workers Issues-triggered repair. `workersIssuesVerified` remains false.
No Slack or HMD run was started. Independent inspect-only
`coverage-flue-budget-after-writer-20261014-1` confirmed all four original IDs,
$0.40 reserved and $6.60 remaining lifetime authorization; no additional AI call.

Create-only complete proof is retained privately in
`/private/tmp/effect-ci-native-writer-20261014-receipt.json`; raw private metadata
is not uploaded. The following opt-in test reads histories and owned GitHub
metadata only; ordinary CI skips it. It cannot redispatch, deploy, infer or write:

```sh
CF_BIN=/Users/eric/Library/pnpm/bin/cf \
LIVE_NATIVE_WRITER_INSTANCE=coverage-native-repair-proposal-20261014-1 \
node --test apps/effect-ci/src/live-repair-writer.test.ts
```
