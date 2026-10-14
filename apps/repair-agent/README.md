# Run a private Flue proposal agent on Cloudflare

This host uses the real pinned Flue generator, its Agents SDK Durable Object,
and account-authenticated Workflows. Its external capabilities are the
private `REPAIR_AI` service and host-only `OWNED_INCIDENT` admission service bindings. No raw AI, GitHub credential, sandbox, shell,
tool, public route, automatic merge or deployment capability is given to the agent.

Only `inspect` or `proposal` administrative modes are accepted. The owned fixture
and prompt are fixed, not forwarded from an event. A proposal is untrusted text,
not a verified repair or a GitHub write. The first native proposal is verified
below; the full error-to-verified-PR chain remains unfinished.

Before a model call, a real Flue interceptor checks the generated DO identity and
framework submission/operation/turn context, persists one immutable call slot in
its SQLite storage, and propagates it with AsyncLocalStorage. A new turn or second
submission cannot create a fresh slot after uncertainty. The broker independently
binds the request digest, reserves its shared lifetime authorization and stores
original response bytes. Model routing hints do not choose any identity.

The host run has a four-call lifetime cap inside the cumulative $7 broker cap.
Flue has one submission attempt; Workflow checkpoints have zero retries. Failure
requires inspection, not an automatic fresh paid call. Tracing and built-in
provider defaults are disabled. The general provider tool guard remains strict;
the explicit proposal policy disables framework delegation and rejects model tools.

`src/cloudflare.ts` uses Flue's supported authored-export seam for the Workflow;
generated agent classes are not copied or replaced. The separate budget broker
keeps its existing RPC entrypoint, namespace and historical charges.

```sh
pnpm --filter @effect-ci-testbed/repair-agent check
pnpm --filter @effect-ci-testbed/repair-agent test
cd apps/repair-agent
cf build
cf deploy --prebuilt
```

Do not dispatch a proposal just to test parsing. First inspect the real ledger,
verify current model pricing, and record a unique create-only dispatch intent.
Local fake-service tests are not native inference, repair or Workers Issues proof.

## Incident-gated proposal continuation

`effect-ci-owned-incident-proposal` is a separate private, authenticated Workflow.
Its ONLY accepted instance/mode pairs are `owned-issue-flue-e28e6b86-inspect-v1`
with `{mode:"inspect"}` and `owned-issue-flue-e28e6b86-v1` with `{mode:"proposal"}`.
Unknown/fresh caller IDs or additional payload fields reject before capabilities
or budget calls. It reads the existing receiver's private `OwnedIncidentAdmission.inspect()`
capability BEFORE any model call. Pinned admission policy/Issue/occurrence/source/version/
private-base/path/operation and admitted timestamp must all match. Service RPC metadata
is stripped by copying only pinned schema fields before strict plain-data validation;
actor accessors/symbols/extra keys remain rejected by the reusable protocol validator.

This explicit host-code activation policy permits **proposal-only** continuation of
ONE enrolled actual Issue. The admission receipt's `repairAuthorized:false` and
`inferenceTriggered:false` flags remain unchanged: admission alone is not paid authority.
No notification text/title/raw context is passed to the model. The generated agent,
fixed fixture/prompt/model, no-tool/delegation policy, durable one-submission SQL slot,
same `friday-flue-proposal-v1` four-call lifetime cap and SAME cumulative$7 broker
ledger are retained. No new budget run or namespace evades old reservations.
The inspection mode calls no budget/model. Proposal mode adds the admission checkpoint
then uses the existing four proposal checkpoints, all zero retries.

The receiver/admission is already natively proved; this **new continuation is NOT yet
deployed or natively executed**. Local tests exercise actual generated workerd/SQLite
agent plus service-bound FAKE admission/budget: fixed inspect consumes nothing, a fresh
owned incident instance makes one fake call, repeated submission is denied without
another charge, invalid admission rejects even after previous success. The Workflow
coordinator is mocked locally; none of this is new native inference. The first local
service test rejected a Disposable RPC wrapper; explicit pinned-field copying fixed
the integration without weakening the pure admission guard. Expected second-submission
negative logs are not test failures. Existing historical proposal receipts are untouched.

To reproduce, first follow the receiver's [owned Issue setup and enrollment guide](../repair-events/REPRODUCE.md)
in your account. This host imports reusable `@effect-ci-testbed/github/incident-proposal`,
not another app's implementation. Review and commit corresponding host-owned enrollment
constants for your independently verified source/version/base; never pass them as event
or model parameters. Build/deploy this private host from exact full-CI-verified source,
preserving its generated DO/provider and existing private budget service. No new secret
or OAuth/App credential is required. Read the deployed bindings/config before dispatch.
Then inspect the fixed admission through the authenticated Workflow API. Before the ONE
fresh proposal, verify official model pricing and current native ledger, save a create-only
intent, use its EXACT fixed instance and `{mode:"proposal"}` structured `--body`, and
reconcile that SAME instance if acknowledgement is uncertain. Do not redispatch for parsing
or proof. This is authenticated operator continuation of an already captured real Issue,
NOT an automatic webhook-triggered repair or a new deployed failure.

The model output remains untrusted; `repairVerified:false` and `githubWritePerformed:false`.
Native exact-commit Node verification and a NEW proposed PR require a separately scoped
trusted App-host writer policy. Never merge/deploy repair PRs. This slice invokes no native
AI or GitHub write; hosting remains subject to account metering. Four actual historical AI
calls/$0.40 reserved/$6.60 authorization are unchanged. For cleanup, disable only the owned
incident automation/policy; retain historical receipts and generated/budget storage, do not
reset reservations or overwrite the old pilot operation.

## Recorded native proposal

Merged source `9ee195f09f239386ceafb290a69253ad201bc5b1` was built and deployed
once as private Worker version `3dbe0295-93e0-47c7-8bb3-75710201154c`, with
only the generated agent DO and `REPAIR_AI` binding. No App credential, raw AI
binding, public URL, sandbox or delegated tool was supplied.

`coverage-flue-inspect-20261014-1` first inspected the same real broker without
inference: $0.30 reserved, $6.70 remaining authorization. Then
`coverage-flue-proposal-20261014-1` completed all four native checkpoints with
one attempt each and zero retries. The real Flue-generated agent returned:

```js
export function healthStatus() {
  return 200;
}
```

One durable `flue_` reservation under `friday-flue-proposal-v1` moved the same
ledger from $0.30 to $0.40 reserved. An independent inspect-only native Workflow
confirmed all four IDs and **$6.60 remaining authorization** without another AI
call. There have been four model calls across the whole demo, not four here.

Observed queue **471 ms**, native Workflow execution **2,576 ms**, total
**3,047 ms**, one sample on October 14, 2026 UTC. These are administrative
Workflow timings, not isolated model latency, billing or an end-to-end repair
benchmark. Original SSE/model-reported identity is not exposed by this receipt;
the broker preserves original bytes privately. No finish/usage is invented.

This proves an actual hosted Flue proposal through Workers AI and the private
durable budget service. It does **not** yet prove native GitHub writing,
exact-commit repair verification, Workers Issues delivery, forced native process
restart, automatic merging or deployment. The local restart/negative tests
remain separate. Private create-only evidence is retained in
`.verification/native-flue-proposal-20261014-1.json`.

```sh
CF_BIN=/Users/eric/Library/pnpm/bin/cf \
LIVE_FLUE_INSTANCE=coverage-flue-proposal-20261014-1 \
node --test src/live-proposal.test.ts
```

That opt-in test reads retained native histories only. It cannot deploy,
redispatch, write GitHub or spend inference.

## Read-only evidence capability

`RecordedProposalEvidence` now reads that fixed completed native Workflow and
independently validates its reservation/run against the existing private broker
ledger. It returns only four bounded fields to a trusted service-bound caller.
It cannot dispatch the agent, call a model, write GitHub or choose an incident.
The generated default entrypoint, agent namespace and `REPAIR_AI` binding remain
unchanged; no App credential, writer service or raw AI binding is added here.

The capability is now **deployed and natively verified** on merged source
`37ccda5045368b5576afc426d85169e78a01ed1d`, private Worker
`92e6cfb8-4344-4141-9cb4-dfffc72ed800`. A real read-only native inspection
validated the historical tuple before the App host created a natively verified
proposed PR. Local tests with fake history/ledger remain separate. The
[native writer pilot](../../packages/github/REPAIR.md#retained-proposal-native-writer-pilot-verified-natively)
records exact identities, replay, timings and limits. Reading the old proposal
never turns it into a fresh Workers Issues-triggered repair; no new AI call was
made by this pilot.
