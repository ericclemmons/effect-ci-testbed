# Cache dependency downloads

Avoid downloading packages again without skipping installation.

[Source](./.cloudflare/ci/actions.ts#symbol=install "source")

The capability uses `.effect-ci/cache/npm`. The runner persists that directory;
npm still runs the locked install against the current checkout.

## Run it

```sh
pnpm exec effect-ci run --workflow examples/package-manager-cache/.cloudflare/ci/workflow.ts
pnpm exec effect-ci run --workflow examples/package-manager-cache/.cloudflare/ci/workflow.ts
```

The second run can reuse downloads. This caches package bytes, not the result
of a test or build.

[Runner configuration](./src/worker.ts) · [Task caching](../vite-plus-cache)
