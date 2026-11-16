# CI.PackageManager

Use a package manager capability to install dependencies or run project scripts
in a workspace. Commands stay attached to the action and its workspace revision.
The runner owns where those commands execute and which cache paths persist.

## Apt

`CI.PackageManager.Apt(workspace)` supplies `install(packages)`. It runs apt-get
on an apt-based runner, using root or sudo. It does not make apt available on
an incompatible host.

[Install a system package](../../examples/system-package/.cloudflare/ci/actions.ts#symbol=installImageMagick "source")

[Apt](../../examples/system-package) · [Python](../../examples/cloudflare-toolchain)

## JavaScript

`CI.PackageManager.JavaScript(workspace)` detects npm, pnpm, Yarn, or Bun from
`package.json` and lockfiles. Conflicting lockfiles or missing configuration fail
with `PackageManagerError`.

The capability provides `install(options?)`, `run(script)`, and `exec(command)`.
Installs freeze the lockfile by default; `frozenLockfile: false` explicitly allows
changes. Each command returns a workspace for the next action.

[Install dependencies](../../examples/node-npm/.cloudflare/ci/actions.ts#symbol=install "source")

[Run a script](../../examples/node-npm/.cloudflare/ci/actions.ts#symbol=test "source")

[npm](../../examples/node-npm) · [pnpm](../../examples/node-pnpm)

## Vite+

Vite+ is not a fifth manager. `name` stays npm, pnpm, Yarn, or Bun: that manager
owns the lockfile, the frozen install, and the runner's package cache under
`.effect-ci/cache/<name>`. Vite+ only changes `run`.

Where the host provides `vp`, `CI.PackageManager.JavaScript(workspace).run(name)`
runs `vp run --cache <name>`, so Vite+ caches each script from the files it reads
and writes. The CLI does this for local workspaces. Elsewhere, `run` uses the
detected manager, and `vitePlus` is `false`.

`CI.PackageManager.VitePlus(workspace)` always runs through Vite+, so `run` also
covers `vite.config.ts` tasks. It uses the global `vp`, or the project's own from
`node_modules/.bin`. Pass `{ cache: false }` to leave script caching to the Vite+
config.

[Run a Vite+ task](../../examples/vite-plus-cache/.cloudflare/ci/actions.ts#symbol=build "source")

[Vite+ cache](../../examples/vite-plus-cache) · [zero-config](../../examples/zero-config)
