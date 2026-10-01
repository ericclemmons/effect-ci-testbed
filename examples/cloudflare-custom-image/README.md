# Add tools to a Cloudflare CI runner

This example answers one question:

> How do I run an Effect CI action with a tool that is not in Cloudflare's default Sandbox image?

The managed Trixie image is enough for Node.js CI. This separate example shows the
escape hatch for a workflow that also needs Python: a named image selected at runtime
by the Workspace Durable Object.

```dockerfile
FROM docker.io/library/node:24-trixie-slim

RUN apt-get install python3 python3-pip
```

The action is ordinary portable Effect CI code:

```ts
export const build = CI.action<PythonArtifacts>("build python package", () => function* () {
  const workspace = yield* checkout()

  yield* workspace.exec("python3 -m build --no-isolation")

  return {
    paths: ["dist/*.whl", "dist/*.tar.gz"],
    workspace,
  }
})
```

`wrangler.jsonc` registers the Dockerfile as the named `python` image. The Workflow
entrypoint asks its Workspace Durable Object for that image; no Sandbox SDK is used.

Start the Worker with Docker running:

```sh
pnpm dev
```

Then trigger its Workflow from another terminal:

```sh
pnpm exec wrangler workflows trigger effect-ci-cloudflare-custom-image \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --local
```

The completed `build python package` step produces a wheel and source archive in the
Container workspace. Artifact publication remains separate from workspace snapshots;
this example is specifically about customizing the execution image.
