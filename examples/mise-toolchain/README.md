# Install runtimes with Mise

Use the Node and Python versions already declared in [mise.toml](./mise.toml).

```ts
const mise = yield* CI.Toolchain.Mise(workspace)
return yield* mise.install()
```

Later commands use `mise.exec(...)`, so no shell activation is needed.
Tool downloads live under `.effect-ci/cache/mise`.

## Run it

With Docker running:

```sh
pnpm exec cf-ci run --workflow examples/mise-toolchain/.cloudflare/ci/workflow.ts
```

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)
