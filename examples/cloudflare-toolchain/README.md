# Prepare and reuse a Cloudflare toolchain

This example answers one question:

> How do I add tools that are not in Cloudflare's managed image without maintaining a Dockerfile?

The Workflow starts from Cloudflare's managed `cloudflare/debian-trixie` image. An
ordinary Effect CI action installs Python and its build tools with `Workspace.exec()`
and returns the prepared logical workspace:

```ts
export const preparePython = CI.action(
  "prepare python toolchain",
  () => function* () {
    const workspace = yield* checkout()

    yield* workspace.exec(
      "DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install --yes --no-install-recommends python3 python3-pip",
    )
    return yield* workspace.exec(
      "python3 -m pip install --break-system-packages --root-user-action=ignore --no-cache-dir build==1.3.0 hatchling==1.27.0",
    )
  },
)
```

The build action consumes that prepared workspace without knowing whether the runner
kept its Container alive or restored its durable revision:

```ts
export const build = CI.action("build python package", () => function* () {
  const workspace = yield* preparePython()

  return yield* workspace.exec("python3 -m build --no-isolation")
})
```

There is intentionally no Dockerfile, named-image configuration, or explicit snapshot
plumbing. The managed image provides the base system; commands describe how to prepare
the workspace; the Cloudflare runner commits returned workspaces as native snapshots.
Future Containers can materialize that logical revision without repeating setup.

Start the Worker with Docker running:

```sh
pnpm dev
```

Then trigger its Workflow from another terminal:

```sh
pnpm exec wrangler workflows trigger effect-ci-cloudflare-toolchain \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --local
```

The completed `build python package` step produces a wheel and source archive in the
materialized workspace. Publishing portable artifacts remains separate from durable
workspace revisions.
