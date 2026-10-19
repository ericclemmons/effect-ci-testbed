# Selected remote goals and failed-command output — October 16, 2026

PR #322 merged as `c9339951930a3c22ab4a28abc8f79819ebfbaad2`.
The existing CI host was updated to version
`a0bcff58-3115-42b7-a7b7-b42413392ba8`, without changing its Container image,
bindings, secrets, Access policy or account permissions.

## Actual native execution

`cf-ci run test build --remote` completed in native instance
`e8db2618-fed0-4681-93fd-64908593f427`, using exact source
`c9db039ed4850eabbc7862304adf30db6c0c7829`.
Independent history readback confirmed one installation, one test command and
one build command. No syntax-policy check, publication, preparation or release
ran. Capability negotiation rejects unsupported targets before dispatch; the
host still runs its enrolled program, not uploaded project TypeScript.

## Actual failed-test output in Slack

An owned preview fixture, `2ef192ba8158679bd6aa95b4ac81aa40cac09b8a`,
deliberately failed its assertion in native instance
`33913260-c9a0-11f1-9486-73fab5073537`. Checkout, syntax, install, lint,
formatting and type-checking passed before the test failed. Its maintained
Slack step reply showed command exit 1, bounded stdout/stderr, the assertion,
Expected/Received values and the source line. Both streams were expanded in
Slack without opening the Dashboard. The parent remained compact.

The fixture is on `codex/slack-output-proof`, not merged. Its earlier lint
failure and all native histories remain intact. Neither failing preview reached
publication. Output is opt-in, bounded and redacted; this does not publish all
host exceptions or successful-command logs. Private screenshots remain private.

## Standalone pnpm export

A real tiged export of `e33deb083aa2e1455df4cc254c40df308272f1c6`
consumed `degit.json` and removed only the copied `package-lock.json`.
The source repository's npm lock remains unchanged. In the new empty copy:

```sh
pnpm install
pnpm build
pnpm test
cf-ci plan test build --format=json
cf-ci run test build --format=json
```

All passed: one app test, 32 verification tests, then both inferred CLI goals
with one shared installation. The CLI was registered in a temporary global bin
directory; no machine-specific link dependency was written into the app.
This proves local standalone setup, not new-repository App enrollment, hosted
execution, full-suite attestation or authored-workflow remote parity.
