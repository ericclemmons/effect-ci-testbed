# Prepare and reuse a Cloudflare toolchain

This example answers one question:

> How do I add tools that are not in Cloudflare's managed image without maintaining a Dockerfile?

The Workflow starts from Cloudflare's managed `cloudflare/debian-trixie` image. An
ordinary Effect CI action installs Python and its build tools with `Workspace.exec()`,
then saves the prepared repository and toolchain as a native filesystem snapshot:

```ts
export const preparePython = CI.action<PythonToolchain>(
  "prepare python toolchain",
  () => function* () {
    const workspace = yield* checkout()

    yield* workspace.exec(
      "DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install --yes --no-install-recommends python3 python3-pip",
    )
    yield* workspace.exec(
      "python3 -m pip install --break-system-packages --root-user-action=ignore --no-cache-dir build==1.3.0 hatchling==1.27.0",
    )

    return {
      checkpoint: yield* workspace.checkpoint("python-toolchain"),
    }
  },
)
```

The build action restores that immutable checkpoint into a fresh Container before it
uses the toolchain:

```ts
export const build = CI.action<PythonArtifacts>("build python package", () => function* () {
  const toolchain = yield* preparePython()
  const workspace = yield* toolchain.checkpoint.restore()

  yield* workspace.exec("python3 -m build --no-isolation")

  return {
    paths: ["dist/*.whl", "dist/*.tar.gz"],
    workspace,
  }
})
```

There is intentionally no Dockerfile or named-image configuration. The managed image
provides the base system; commands describe how to prepare the workspace; the snapshot
is the reusable output. Future sandboxes can restore it without repeating setup.

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
restored Container workspace. Publishing portable artifacts remains separate from
workspace snapshots.
