# Declare secrets without putting them in a container

This example answers one question:

> How does an action require a credential without leaking it into plans, logs, or command environments?

```ts
const token = yield* CI.Secret("REGISTRY_TOKEN")
```

The plan records only the requirement name. Execution returns an Effect `Redacted`
value from the runner's `SecretResolver`, and JSON/log rendering remains redacted.
`Workspace.exec` deliberately has no `env` or secret injection option: credentials
should be consumed by a host-side capability, RPC service, or an outbound proxy that
substitutes placeholders without exposing values to the workload container.

The default local resolver reads process environment variables. A Varlock adapter,
Cloudflare Secrets Store adapter, or credential-validation approval can implement the
same small resolver contract later.

```sh
node --import tsx examples/secure-secrets/verify.ts
```
