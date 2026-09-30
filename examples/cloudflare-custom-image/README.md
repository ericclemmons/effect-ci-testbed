# Add tools to a Cloudflare CI runner

This example answers one question:

> How do I run an Effect CI action with a tool that is not in Cloudflare's default Sandbox image?

The default Sandbox image is intentionally lean and does not include Python. This
example chooses Cloudflare's matching `-python` image and installs the Python build
frontend and backend used by the action:

```dockerfile
FROM docker.io/cloudflare/sandbox:0.12.10-python

RUN pip install --no-cache-dir build==1.3.0 hatchling==1.27.0
```

The action is ordinary portable Effect CI code:

```ts
export const build = CI.action<PythonArtifacts>("build python package", () => function* () {
  const workspace = yield* checkout()

  yield* workspace.exec("python -m build --no-isolation")

  return {
    paths: ["dist/*.whl", "dist/*.tar.gz"],
    workspace,
  }
})
```

`wrangler.jsonc` points the `Sandbox` container at `./Dockerfile`; Wrangler builds that
image for both local development and deployment. The Sandbox npm package and Docker
image stay pinned to the same `0.12.10` release.

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
Sandbox workspace. Artifact persistence and download are separate future capabilities;
this example is specifically about customizing the execution image.
