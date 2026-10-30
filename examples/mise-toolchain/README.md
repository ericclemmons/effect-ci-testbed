# Install runtimes with Mise

Use the Node and Python versions already declared in [mise.toml](./mise.toml).

[Source](./.cloudflare/ci/actions.ts#symbol=installToolchain "source")

Later commands use `mise.exec(...)`, so no shell activation is needed.
Tool downloads live under `.effect-ci/cache/mise`.

## Run it

With Docker running:

```sh
cd examples/mise-toolchain
effect-ci run
```

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)
