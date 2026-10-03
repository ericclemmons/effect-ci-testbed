# Install a declared toolchain with Mise

This example answers one question:

> How do I install every runtime declared by my project's Mise configuration?

The project declares Node and Python in [`mise.toml`](./mise.toml). Its action acquires the
workspace-bound Mise capability and returns the workspace after installation:

```ts
export const installToolchain = CI.action("install toolchain", () => function* () {
  const workspace = yield* checkout()
  const mise = yield* CI.Toolchain.Mise(workspace)

  return yield* mise.install()
})
```

`CI.Toolchain.Mise` owns `.effect-ci/cache/mise`; workflows do not need to know Mise's
data or download-cache layout. Commands use `mise.exec(...)` so shell activation is not
required in local or CI environments. The workflow exports its `local` runner so both
the executable entrypoint and Effect CI's GitHub adapter use the same Mise image.

Compare:

- [plain GitHub Actions using `jdx/mise-action`](./.github/workflows/github.yml)
- [Effect CI on GitHub](./.github/workflows/effect-on-github.yml)
- [the portable actions](./.cloudflare/ci/actions.ts)
- [the local-container entrypoint](./.cloudflare/ci/workflow.ts)

With Docker running:

```sh
./examples/mise-toolchain/.cloudflare/ci/workflow.ts
```

The official Mise Debian image supplies only the runner capability. Tool versions stay
in the project configuration, and later runner layers can cache the capability-owned
paths without changing this workflow.
