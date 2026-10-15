# Owned failure signal

Private, standalone deterministic failure source for the Friday incident loop. No public URL, secrets, AI, GitHub, repair writer, arbitrary prompt, or deployment binding. An authenticated native Workflow may inspect or emit ONE owned error. A SQLite claim precedes `console.error(new Error(...))`; completed calls replay the same 500 receipt without logging again. Pending/uncertain state fails closed and has no reset API. The private RPC returns an actual 500 Response; ordinary HTTP remains 404.

## Public HTTP source preparation (not activated)

The next end-to-end test needs a genuine public fetch exception, not another replay
of that completed private RPC. `src/public-fault.ts` implements an owned `/failure`
GET using the same fixed `healthStatus()` fixture. A separate `PublicFailureClaim`
SQLite object durably claims the attempt **before** the uncaught HTTP exception.
Concurrent/later GETs return410 without logging or returning a cached500. Claim or
acknowledgement uncertainty returns409 and never retries; a claim is NOT proof the
exception occurred or an Issue was delivered. There is no reset endpoint. Root,
queries, other methods and declared prefetch requests do not consume the claim.
An ordinary deliberate browser GET can consume it once after activation; this is
a test source, not an authentication or approval endpoint.

This route is **host-disabled** (`publicFailureEnabled=false`) and workers.dev
remains disabled. No native HTTP exception, Issue, inference or repair has been
triggered by this preparation. The existing emission/journal is not read/reset
by the new record. Actual local workerd tests exercise eight concurrent GETs
(one500/seven410), module reload (still410), the unchanged old RPC record and the
production404 gate. They do not prove native WOBS delivery or automatic repair.

Do not enable/deploy the public test merely to collect an error. First finish the
authenticated receiver's bounded automatic activation/outbox and independently
enroll the exact producer version/source, private fixture base/path/bytes and
existing budget policy. Preserve the old capture/admission/proposal records.
Then use exact merged-source build, fresh resource/secret/controller preflight,
create-only intent and independent deployment readback before exposing workers.dev
and deliberately loading `/failure` once. No error/Issue identity may select a
repository, prompt, model, paid slot or writer destination. Proposed repairs remain
unmerged and undeployed. Necessary resources are the one additional SQLite class
on this existing owned Worker; no new secret, outbound service or account scope.
Costs are ordinary Worker/SQLite/Issues operations; this preparation makes no AI
call. Safe stop is to keep the source gate and workers.dev disabled, retaining the
claim and all evidence rather than resetting/deleting it for rehearsal.

`observability.issues.enabled` is explicitly configured. [Cloudflare Issues](https://developers.cloudflare.com/workers/observability/issues/) documents handled error logging and 5xx detection. A completed emission is NOT proof that an Issue was ingested, that a Notification was delivered, or that a repair happened. `issueVerified:false` remains explicit until independent native evidence exists.

This app owns its fixture; it does not import private repository code or claim source parity with its repair target. The fixed safe message contains no incoming request or account context. Full source/version-to-private-base enrollment is still required before any paid event-triggered repair.

Local checks: `node --test src/*.test.ts` and `pnpm check`. Native deployment/emission/Issue lookup and authenticated capture are now independently proved below; semantic incident dedupe and ordered Flue-to-verified-PR proof remain pending. Never label a synthetic Notifications test or a local workerd error as a real native Issue.

Genuine native emission (2026-10-14): after the authenticated receiver and independently read-back fixed-service automation were ready, ONE `coverage-owned-incident-emission-20261014-1` completed one checkpoint/one attempt/zero retries. Checkpoint output contains actual status500 and `replay:false`; top-level Workflow output serialized status as `unknown`. Both original outputs are preserved, not rewritten. Actual Issue `e28e6b86-bea4-440f-8729-be6437e97293` has retained occurrence `01M4XA9MBZ0000000000000009`, exact deployed version `20a3b050-574b-40fc-bf22-5d4086926484`, `OwnedFaultOnce`/jsrpc/structured-log, and the exact owned safe error message. The [receiver evidence](../repair-events/README.md) independently matches its authenticated notification. This is a handled logged error from private RPC, not an uncaught exception or public failing URL. No source replay, AI, repair, private fixture write, merge/deploy, Slack or HMD approval occurred. Keep `issueVerified:false` in original emission receipts: independent evidence does not rewrite historical outputs. Do not re-emit or reset this source for rehearsal.

Deployment may precede the receiver, but do not invoke `emit-once` until the authenticated destination, fixed-service Issue automation and bounded receiver are ready. `inspect` emits no error. The single durable emission has no reset route; rehearsals must read its evidence rather than pretending replays are new incidents. Returning a cached 500 may itself create another platform occurrence even though the application does not log again, so replay is not an occurrence-deduplication guarantee. Receiver deduplication remains a separate prerequisite.

Native preparation (2026-10-14): merged source `ff1a3497552d6e165b2407ab165d98f684ea84d2` deployed once as private version `20a3b050-574b-40fc-bf22-5d4086926484`. API readback returned `urls:[]` and the intended three exports. Inspect-only instance `coverage-owned-incident-inspect-20261014-1` completed one checkpoint/one attempt/zero retries with state `absent` and `issueVerified:false`. No error, inference or repair was emitted. Issues is enabled in the compiled configuration, but ingestion/delivery still has no native proof. The private create-only inspect receipt is retained locally; do not redispatch it or publish its account metadata.
