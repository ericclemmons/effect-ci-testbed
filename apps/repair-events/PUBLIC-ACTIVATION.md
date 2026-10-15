# Automatic public-incident activation (disabled preparation)

This is the receiver side of the next **owned test**, not a live automatic repair
claim. Production `src/public-enrollment.ts` exports `undefined`; notification
handling remains capture-only. No new service bindings are configured, deployed
or given credentials. The public producer is also disabled. Existing old
capture, semantic admission, model and writer records are unchanged.

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
generated-agent and App Workflow compositions. They have **not been deployed or
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
source reads; production stays capture-only even with those fake bindings;
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
export on the existing receiver, without new outbound bindings or secrets. Future
bindings require explicit fixed owned service identities and documented fresh
preflight. Exact merged-source build, private create-only intent, one deployment
and independent security/resource readback still apply. Do not deploy controllers
during an active release or change the committed demo allocation.

Costs are ordinary Worker/RPC/SQLite operations; no inference is spent by these
tests or this disabled preparation. Do not reinterpret the lifetime AI authority
as per-run credit. Keep the source/enrollment disabled to stop safely; preserve
all claims/captures/outboxes/budget histories. Never merge or deploy a proposed
repair, delete a journal or replay the old incident to make the demo look green.
