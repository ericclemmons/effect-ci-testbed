# Hosted demo test fixture

For the hands-on tutorial, use [examples/demo](../../../examples/demo).
This directory is retained for integration tests and historical hosted evidence;
it is not a template or an automatically deployed app.

```sh
pnpm test
pnpm build
pnpm test:integration
```

Application tests live beside the source. Integration tests and retained
recordings live in `test/`. The npm lockfile is an input to the existing
fixed-policy hosted checks, not a package-manager recommendation for the tutorial.

[Hosted attestation evidence](../../../apps/effect-ci/TRUSTED-REMOTE.md) ·
[Recording evidence](./test/README.md)
