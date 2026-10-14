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

The receiver/admission and this continuation are now separately natively proved below.
Local tests exercise actual generated workerd/SQLite
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

Native incident continuation (2026-10-14): exact merged source `9e0afc23b9c36b8f505c68df62935d2239ba27a9`
rebuilt1657modules and deployed once as private agent version `a8bfdf29-f2a1-421f-a4ef-ee88e522149f`.
Actual bindings retain the generated SQLite namespace, `REPAIR_AI` and ONLY the private
`OWNED_INCIDENT` service; no secret/writer/public route. Fixed inspect completed with no AI.
ONE `owned-issue-flue-e28e6b86-v1` completed17:12:57.208UTC, all FIVE checkpoints once/zero retries,
class `c584b280-2ae8-486b-8ea7-7b50ec9b9ca5`. Admission verified BEFORE the fresh Flue dispatch,
which returned exact untrusted `export function healthStatus() { return 200; }`.
New reservation `flue_54c540e5b12e62cae83001008487f8a26b1652a7664fb511a576e045f8e47c87`
under SAME `friday-flue-proposal-v1` moved40→50 cents reserved/660→650 cents remaining.
Independent inspect-only before/after histories retain all FOUR old IDs. FIVE actual AI
calls across all history; $6.50 lifetime authorization remains, NOT measured billing.
The host run now used2of4 lifetime slots. Official model pricing/limits were rechecked
before a create-only proposal intent; no retries/fallback or source re-emission occurred.

Native queue243ms/execution4548ms/total4791ms, one sample of **operator continuation**
after a previously authenticated real Issue and native admission. Not a measured whole
500→Issue→repair-PR benchmark or automatic webhook activation. Raw model alias/finish/usage
is not exposed by this host receipt and is not invented. Private full receipt/intents
retain source/deployment/histories, never diagnostics or credentials in a public artifact.

Read-only regression: `LIVE_INCIDENT_FLUE=owned-issue-flue-e28e6b86-v1 CF_BIN=/Users/eric/Library/pnpm/bin/cf node --test src/live-incident-proposal.test.ts`.
It reads only retained proposal and before/after histories. Ordinary CI skips it; no
redispatch, emission, inference, GitHub write or deployment. Never spend again to parse
or retest this completed proposal. Earlier historical proposal evidence is unchanged.

The model output remains untrusted; `repairVerified:false` and `githubWritePerformed:false`.
Native exact-commit Node verification and a NEW proposed PR require a separately scoped
trusted App-host writer policy. Never merge/deploy repair PRs. This slice invokes no native
GitHub write; hosting remains subject to account metering. The one fresh native call is
explicitly recorded above; do not reset its reservation. For cleanup, disable only the owned
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

`IncidentProposalEvidence` is a NEW private capability for the **fresh admitted-Issue**
proposal, not a relabeling of `RecordedProposalEvidence`. It reads its OWN fixed
completed `IncidentProposalWorkflow.status()` and an independently current broker
ledger. The reusable lightweight `github/incident-evidence` protocol checks enrolled
Issue/source/version/base/admission, activation policy, exact model submission/UID/
acceptance time/reservation/run/original text, historical40→50-cent transition and all
five retained IDs in the current$7 ledger. Unknown/pending/foreign/tampered/duplicate
or missing identities reject. Later valid reservations do not invalidate historical
proof. No actor/model `passed:true` is verification authority.

It returns only seven bounded plain fields (instance/reservation/run/text/Issue/
operation/activation policy), no raw capture or arbitrary reply. It has no dispatch,
AI call, credential, writer, merge or deployment method; HTTP404. The authenticated
`effect-ci-owned-incident-evidence` Workflow accepts ONLY `{mode:"read"}`, uses zero
checkpoint retries and explicit plain RPC field copies. No new external binding,
secret, namespace, dependency or model authority is added. `Workflow.status()` exposes
completion/output, **not per-step attempts**; the separate retained native regression
above verifies all five actual checkpoint histories. Do not claim the capability
queried those attempts through a nonexistent API.

Local actual workerd/Workflow/RPC tests read clearly FAKE completed history and a
separate fake ledger that throws on inference, serialize the reader checkpoint,
reject incomplete source history and fail after ledger invalidation. Pure protocol
negative tests reject changed model/incident/budget/receipt identities and accessors.
The actual retained native proposal also passes the pure validator offline with no
model call. The capability is now natively verified (2026-10-14): exact merged source
`15a0144299b08af47ddf037e2dde7b5b2ccd7c72`, rebuilt1659modules, deployed once as private
version `0f1fb80d-bb61-4d64-8756-120a786c63d8`. Independent version readback confirms the
same generated SQLite namespace, existing broker/admission bindings and no public URL
or secret. ONE read-only instance completed18:30:46.392UTC, one checkpoint/attempt,
zero retries, returning the seven original bounded fields. Its actual ID is
`cf_3fd031ac19e7130f22c40e61a51b95af933aeee6d70eee40a40cdb5a4a569653`.
The operator supplied `id` instead of `instance_id` in the raw create body, so the
platform generated that ID. The original intent and returned identity are retained;
only that actual instance was reconciled, with NO redispatch. Reproduction must use
`--body '{"instance_id":"YOUR_READ_ONLY_ID","params":{"mode":"read"}}'`.
Queue2507ms/execution1001ms/total3508ms, one read-only orchestration sample, NOT model
latency or full repair timing. A separate native inspect-only budget Workflow confirms
50 cents reserved/650 remaining and all five IDs unchanged. No inference, GitHub write,
new error emission or repair authorization occurred. Private create-only full receipt
and pre-dispatch intents are retained; existing histories must never be redispatched.
Read-only regression: `LIVE_INCIDENT_EVIDENCE=cf_3fd031ac19e7130f22c40e61a51b95af933aeee6d70eee40a40cdb5a4a569653 CF_BIN=/Users/eric/Library/pnpm/bin/cf node --test src/live-incident-evidence.test.ts`.

The subsequent trusted App host writer must use a NEW immutable incident operation,
canonical patch validation and real exact-commit Node check before proposing a PR.
It must not reset the older administrative pilot, give credentials to this host/model,
accept a model verification claim, merge or deploy a fixture repair. See the receiver's
[reproduction and safe cleanup guide](../repair-events/REPRODUCE.md); read-only inspection
still uses account Workflow/storage metering but no inference. Five historic AI calls/
$0.50 reserved/$6.50 authorization remain unchanged in this capability slice.

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
