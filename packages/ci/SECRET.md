# CI.Secret

Use `CI.Secret(name)` to declare a secret requirement without putting its value
in the workflow plan. Execution returns an Effect `Redacted<string>`; missing
values fail with `SecretError`.

[Declare and resolve a secret](../../examples/secure-secrets/.cloudflare/ci/actions.ts#symbol=authenticate "source")

Planning records the name and uses an empty redacted placeholder. The default
local resolver reads the process environment; a host can supply its own resolver.
Redaction does not prevent a caller from deliberately revealing a value or
putting it in a shell command. Keep credential use in trusted host capabilities
when workloads should not receive the credential.

[Redaction](../../examples/secure-secrets) ·
[Host-authenticated requests](../../examples/secret-outbound)
