# Reuse signed evidence for side-effect-free checks

This example answers one question:

> If the exact commit already passed lint locally, can trusted CI avoid doing the same work again?

An action opts in explicitly:

```ts
CI.action("lint", ..., { verification: { scope: "commit" } })
```

The runner's `VerificationStore` binds evidence to the immutable revision, workflow,
action, command, workspace identity, and policy. A valid signature skips the command;
a miss, changed revision, invalid signature, or verifier error runs it normally. Core
never trusts a Git note merely because it exists. A Git note is one possible transport
for the signed envelope, while the verifier's configured public key establishes trust.

Only side-effect-free checks belong here. Builds, migrations, deployments, and checks
whose outputs are consumed by later steps must not opt in.

```sh
node --import tsx examples/verification-evidence/verify.ts
```
