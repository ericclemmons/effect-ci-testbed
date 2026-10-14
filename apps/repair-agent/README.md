# Run a private Flue proposal agent on Cloudflare

This host uses the real pinned Flue generator, its Agents SDK Durable Object,
and an account-authenticated Workflow. Its sole external capability is the
private `REPAIR_AI` service binding. No raw AI, GitHub credential, sandbox, shell,
tool, public route, automatic merge or deployment capability is given to the agent.

Only `inspect` or `proposal` administrative modes are accepted. The owned fixture
and prompt are fixed, not forwarded from an event. A proposal is untrusted text,
not a verified repair or a GitHub write. Native verification remains pending.

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
