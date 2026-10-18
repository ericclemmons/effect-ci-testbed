# Sign execution results

Reuse valid results. Review the change, not the same test run twice.

`signExecutionReceipt` records the actual `onAttempt` result: workflow conclusion,
every step's observed status, and output commitments. It is not limited to the
demo's test/build names or pure checks. Failed workflows retain successful outputs;
failed steps gain no invented result. Void checks are distinct from missing output.
Reused/verified statuses remain reused/verified; a receipt does not pretend they
were freshly executed. The host retains the underlying evidence lineage.

```ts
import { signExecutionReceipt } from "@effect-ci-testbed/cloudflare/execution-receipt";

const onAttempt = async (attempt, context) => {
  const receipt = await signExecutionReceipt({
    keyId: host.keyId,
    key: host.privateKey,
    identity: await host.identify(context, attempt),
    instanceId: context.instanceId,
    attempt,
  });
  await host.journal(context.instanceId, attempt.number, receipt);
};
```

The operator supplies that host implementation. Resolve repository/commit, event,
input, runtime and policy identities independently; never sign a digest supplied
by a remote caller or project command. Keep the key outside the workspace. Journal
uncertain writes under the same native instance/attempt identity, not a new UUID.

`verifyExecutionReceipt` requires the expected identities and an enrolled issuer
key. It returns the signed observation, not an automatic cache hit or merge grant.
The distinct signature domain cannot be mistaken for a reusable-check or workspace
receipt. A signature proves what the issuer stated, not that its input inventory
was complete.

Snapshot/checkpoint/artifact handles and bounded JSON outputs are hashed, not
published. Keep actual private handles in host storage. Unsupported output values
are explicitly `uncommitted`; getters and `toJSON` are not called. A hash is not
encryption: do not use low-entropy private outputs as public commitments.

Same verified inputs and available output should normally mean reuse. An external
write still needs its durable acknowledgement; restoring a snapshot does not send
a notification or deploy it again. PR policy can approve from verified results or
defer to required owners. Neither signing nor verification changes GitHub rules.

This observes the CI attempt before `finalize`, not a later release outcome. Tests
cover real kernel attempts and local native adapters with fake persistence; no
generic live signer, key enrollment, artifact availability or safe-skip proof is
claimed. Self-hosting does not require the demo's keys, App or policy.
