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

Trust is repository policy, not something the signature decides:

- **Developer-authorized:** a collaborator with push access signs both the commit and
  the verification envelope using an enrolled GPG, SSH, or device key. This proves who
  asserted the result, not that an independent machine observed the execution. It is a
  pragmatic policy for lint, formatting, type checking, and ordinary tests.
- **Managed-agent:** only keys issued to approved agent sandboxes are accepted. This
  reduces trust in arbitrary developer machines while still allowing agents to finish
  checks before pushing.
- **Remote-attested:** local execution dispatches a trusted remote runner, which signs
  the result and returns asynchronously. This gives stronger execution provenance but
  intentionally does not save remote compute.

A signed Git commit by itself is insufficient because it contains no assertion about
which action ran or what result it produced. The evidence needs its own signature (or
must be included in signed commit content) and must bind to that exact commit. The
GitHub App verifies the configured policy and publishes the required check; GitHub is
never asked to trust an arbitrary status submitted by the developer. Repositories can
mix policies—for example, accepting developer proofs for lint while always rerunning
release and security checks remotely.

Only side-effect-free checks belong here. Builds, migrations, deployments, and checks
whose outputs are consumed by later steps must not opt in.

Run the canonical workflow locally with
`./examples/verification-evidence/.cloudflare/ci/workflow.ts`, or through
[Effect on GitHub](./.github/workflows/effect-on-github.yml). The in-memory Ed25519
proof store is test infrastructure, so it lives in
[`tests/verification-evidence.test.ts`](./.cloudflare/ci/tests/verification-evidence.test.ts)
rather than masquerading as the workflow entry point.
