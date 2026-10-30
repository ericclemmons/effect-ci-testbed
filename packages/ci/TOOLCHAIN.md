# CI.Toolchain

Use a toolchain when a project selects a runtime or task runner. The capability
reads configuration from its workspace; the host must supply the required
installer and command environment.

## Mise

`CI.Toolchain.Mise(workspace)` reads `mise.toml`, `.mise.toml`, or `.tool-versions`.
It supplies `install({ locked? }?)` and `exec(command)`. Missing configuration
fails with `ToolchainError`. Mise must already be available on the runner.

[Install configured runtimes](../../examples/mise-toolchain/.cloudflare/ci/actions.ts#symbol=installToolchain "source")

[Mise](../../examples/mise-toolchain)

## Node

`CI.Toolchain.Node(workspace)` reads `.node-version`, `.nvmrc`, then
`package.json#devEngines.runtime`. It supplies `install()` and `exec(command)`
through Mise. Missing or invalid version configuration fails with `ToolchainError`.

[Install the selected Node version](../../examples/node-version/.cloudflare/ci/actions.ts#symbol=installNode "source")

[Node](../../examples/node-version)

## Turbo

`CI.Toolchain.Turbo(workspace)` supplies `tags(...)` for the experimental native
graph adapter. It expands tagged tasks during execution and keeps Turbo's task
hashing and cache behavior. Ordinary planning does not expand that graph.

[Run tagged tasks](../../examples/turbo-distributed/.cloudflare/ci/workflow.ts#symbol=default "source")

[Turbo](../../examples/turbo-distributed)
