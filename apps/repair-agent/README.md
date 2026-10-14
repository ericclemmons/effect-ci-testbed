# Run a private Flue proposal agent on Cloudflare

This host uses the real pinned Flue generator, its Agents SDK Durable Object,
and an account-authenticated Workflow. Its sole external capability is the
private `REPAIR_AI` service binding. No raw AI, GitHub credential, sandbox, shell,
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
