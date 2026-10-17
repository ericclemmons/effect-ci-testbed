# Automatic public-incident activation (version-pinned preparation)

## Current v2 native result

Issue `52da6a3f-87f0-49cd-865d-c7d7030a169b` came from one genuine public GET on
the enrolled version below. Its authenticated capture automatically started one
fresh Flue proposal, exact-commit native Node check and OPEN/UNMERGED PR4. The
final renamed-bot identity check then failed; separately approved read-only operator
reconciliation completed and updated the same Slack card. The original errored
Workflow/failed writer record remain untouched. No second error, inference,
Node command, code/PR write, merge or repair deployment occurred in reconciliation.
[Exact evidence and read-only acceptance](../effect-ci/PUBLIC-REPAIR.md).

## Approved v2 preparation (historical)

The next HOST enrollment pins `owned-public-health-500-v2` to source
`f8eb61a874ccf972fceed25ed6889978608d87bc` and independently deployed producer
`9c829b54-985d-4811-b806-690f93338284`. Eric explicitly approved this ONE fresh
bounded test after the event-routing correction. It is not a replay/reset of the
expired v1 claim. The resulting native execution and final identity-check failure are
recorded above, not relabeled as a clean automatic Workflow success.

The receiver now sends the private canonical `.trigger` event only after durable
admission. The CI host re-reads admission before selecting its fixed repair
Workflow. An existing public admission or writer slot prevents another arm.
The same lifetime model ledger and host-call cap remain unchanged.

## Retained previous test

This is the receiver side of the next **owned test**, not a live automatic repair
claim. Production `src/public-enrollment.ts` pins producer version
`cd91c304-a8a1-48f5-97cf-ad60b7edb285` to exact deployed source
`23bdde6b7bd4924d13cb34666c484e3f6888e21b` and the fixed fixture digest.
The private downstream services are deployed; the source is still unarmed and
native `/failure` returned409 without consuming the test. Existing old
capture, semantic admission, model and writer records are unchanged.

## Actual public test: stopped before paid dispatch

On October15 the authenticated arming Workflow completed once, then one normal
built-in-browser GET produced a genuine uncaught fetch exception (Cloudflare1101).
Actual Issue `a077ace1-d3b3-4c70-83eb-7e2178164871` has one occurrence
`01M50DJ8EW0000000000000006`, exact producer version above, `fetch` invocation and
`exception` mechanism. Its normal authenticated notification was captured about
29seconds later. This is public HTTP/Issue/authenticated-capture proof, **not a
completed automatic repair**: no public proposal or repair Workflow started.

The native title masks the identifier as literal `<token>`. The initial exact
title policy expected its original spelling and rejected admission before paid
dispatch. A regression reproduces that failure and now pins only the exact
observed masked title; `<token>` is not a regex/wildcard or source proof. Private
version/fixture corroboration, timestamp ordering, five-minute freshness, one
occurrence, outbox and spending fences are unchanged. Expired delivery is not
re-admitted to make this run green. The original event/claim/capture are retained;
never replay the error or invent a replacement identity for evidence.

The actual private claim was timestamped37ms before the occurrence; authenticated
capture arrived about29seconds later, inside the unchanged five-minute limit.
A pure read-only comparison of the ACTUAL retained receipt at its original
delivery time rejects the old title and accepts the corrected literal with all
other fences intact. Validation at the current expired time still rejects.
This comparison never changes a native clock or writes admission/outbox state.
Post-failure native budget inspection confirmed the exact same five reservations,
50cents reserved/650cents authorization left and zero new calls. PRs1–3 remain
open/unmerged; no PR4 or repair deployment was created by this test.

Read-only native regression (ordinary CI skips):

```sh
LIVE_PUBLIC_INCIDENT_STOP=1 CF_BIN=path/to/installed/cf node --test apps/repair-events/src/live-public-stop.test.ts
```

It reads the original arming/claim/capture/Issue/occurrence and before/after budget
histories only. It cannot emit, activate, reset, spend, write a PR or redispatch.

Authenticated inspection now also accepts exact `{mode:"public-source"}` to
read the SAME fixed private source claim. It cannot admit, dispatch, mutate/reset
the source or infer, and has no public HTTP endpoint. Use it to investigate native
clock/protocol differences; never fabricate a producer receipt from a timestamp.

## The boundary

After normal shared-secret authentication and bounded immutable capture, an
enabled HOST enrollment selects one fixed `PublicIncidentActivations` SQLite
object. That object reads the capture internally and obtains a separate private
producer claim. A request supplies no raw RPC evidence, enrollment, source,
repository, prompt, model, paid identity or destination.

The shared `packages/github/src/public-incident.ts` protocol requires:

- Exact host-enrolled service, deployed version, emission and fixture digest.
  Current version must still equal the claimed version. The host pins the version
  to independently retained exact-source deployment evidence; this is developer
  enrollment/private-source corroboration, **not occurrence-API attestation**.
- A real-time Issue START for the enrolled notification policy, matching bounded
  correlation and Issue UUIDs, one active exception occurrence, one service and
  the fixed owned error title. The new native exception envelope still needs
  actual verification; local synthetic envelopes are not that evidence.
- A valid durable claim no older than five minutes, with the exception observed
  within five seconds after it. These are fail-closed host limits, not a platform
  delivery SLA. Delayed/recurring/foreign/mixed-service events cannot start work.

No raw title, stack, request context or notification text escapes admission.
Repository/base/path/prompt/model and the lifetime budget remain separately
pinned by the future repair host, not inferred from an event.

## Permanent admission and outbox

The one permanent outbox slot stores the complete normalized admission and a
canonical digest **before** calling the trusted dispatcher. Its Workflow ID is
`public-incident-` plus that digest. A duplicate transport/formatting or later
different Issue cannot select another slot or paid operation.

The dispatcher must acknowledge that same ID. Sending, acknowledgement or SQLite
uncertainty leaves `dispatching`; duplicates do not send again. There is no reset,
delete, fail-to-absent, fresh-ID retry or background paid retry. Recovery requires
separate read-only reconciliation of that SAME Workflow. This is intentionally
fail-closed, not a claim of guaranteed delivery under crashes.

Private read-only `PublicIncidentAdmission.readPublicAdmission(instance)` gives
the started Workflow the validated immutable admission, including while its create
ACK is in flight. It cannot admit, dispatch, change a fixture or infer. The
downstream Workflow and bounded model/native verifier/proposed-PR/Slack stages are
now [connected in host source](../effect-ci/PUBLIC-REPAIR.md), with separate local
generated-agent and App Workflow compositions. They are deployed but **not
proved native end to end**. No local dispatcher result is a native Workflow proof.

## Verification

From the repository root:

```sh
node --test packages/github/src/public-incident.test.ts
node --test apps/repair-events/src/*.test.ts
node --test apps/repair-incident/src/*.test.ts
```

The local workerd test compiles a clearly synthetic, test-only host enrollment
and fake private producer/dispatcher services. It proves authentication precedes
source reads in the actual enrolled host; a distinct historical capture-only
host fixture remains capture-only even with fake bindings;
concurrent valid deliveries dispatch once; normalized identity is privately
readable; formatting changes and module reload preserve the same record; foreign
Issues reject; and a dispatcher which creates then loses its ACK is never called
again after reload. The fake dispatch counter itself uses SQLite. No model,
GitHub write, live HTTP error or platform notification is involved.

For the existing historical native Issue regression, use the current discovered
`cf observability issues ...` commands, not the retired `cf o11y ...` alias.
`CF_BIN` can select an installed CLI; otherwise the test resolves `cf` from PATH.
Historical read-only evidence does not authorize a new inference or activate this
new path.

## Deployment, permissions, costs and safe stop

Do not populate the host enrollment until the exact producer version/source and
fixture bytes have been independently read back and the private evidence plus
bounded dispatcher/agent/writer capabilities are implemented and tested. Keep
the existing cumulative ledger and host call limit. Never give personal OAuth,
the Notifications secret, GitHub key or a deployment token to a project/model.

This preparation declares one additional SQLite class and one private read-only
export on the existing receiver. Enrollment enables only the fixed private
producer-evidence and App-dispatcher bindings, not a new secret or account scope.
Exact merged-source build, private create-only intent, one deployment
and independent security/resource readback still apply. Do not deploy controllers
during an active release or change the committed demo allocation.

Costs are ordinary Worker/RPC/SQLite operations; no inference is spent by these
tests or this unarmed preparation. Do not reinterpret the lifetime AI authority
as per-run credit. Keep the source/enrollment disabled to stop safely; preserve
all claims/captures/outboxes/budget histories. Never merge or deploy a proposed
repair, delete a journal or replay the old incident to make the demo look green.
