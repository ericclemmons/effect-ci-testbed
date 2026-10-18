# Record what actually ran

Both Cloudflare entrypoint adapters accept `onAttempt(attempt, context)`. It is a
trusted, deployment-time callback—not a function or “passed” flag from project
files or the remote HTTP caller.

The kernel supplies the actual CI attempt: conclusion, plan and completed outputs,
including committed Workspace snapshot handles. A failed workflow retains its
successful outputs without manufacturing an output for the failed step. Context
supplies the host environment/exports, native instance ID and run parameters.

Recording runs in `host-attempt:N`, with zero retries and a one-minute timeout.
Planning never records. Recording failure fails the native run with a bounded,
redacted error; it cannot publish a successful overall result first. The handler's
return value is not serialized. Store identity/evidence deliberately—never copy
the host context, credentials or arbitrary private outputs into a public receipt.

Use `context.instanceId` and `attempt.number` for durable identity. The kernel's
`attempt.id` can change during native replay. Journal uncertain external writes;
a lost acknowledgement is not permission to issue a second record or signature.

This observes the **CI definition's attempt**, before any `finalize` continuation.
A successful build followed by a failed release remains a successful build and a
failed native run—not a production-release attestation.

The [execution receipt](./execution-receipt.md) signs these observations for any
check/action in a Git-backed workflow, not a fixed demo suite. Source/runtime/input
verification, artifact storage and consumer trust remain host-adapter responsibilities.
`executionEvidence` can project public
stored evidence into a successful remote result. Neither hook grants cache reuse,
PR approval or deployment authority; those decisions belong in workflow policy.

The local workerd tests exercise both adapters with fake persistence/snapshots.
They are not a deployed generic signer or a fresh-account attestation proof.

```sh
node --test packages/cloudflare/src/host-attempt.test.ts packages/github-cloudflare/src/host-attempt-runtime.test.ts
```
