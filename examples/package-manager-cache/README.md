# Reuse a package-manager download cache

This example answers one question:

> How does an install reuse package-manager downloads without replacing its incoming workspace?

The consumer action contains no runner-specific cache plumbing:

```ts
export const install = CI.action("install", () => function* (options = {}) {
  const workspace = yield* checkout()
  const npm = yield* CI.PackageManager.JavaScript(workspace)

  return yield* npm.install(options)
})
```

The npm capability places its content-addressed download cache at
`.effect-ci/cache/npm` and always runs the normal install command. In CI, the locked
install form (`npm ci`) is the default. Restoring the cache accelerates that command;
it does not return a cached action value or replace the workspace produced by
`checkout()`.

The Cloudflare runner persists that tool-owned directory between independent Workflow
instances. The first E2E invocation installs normally and populates the cache. The
second starts a fresh Workflow and requests `{ "offline": true }`; installation can
only succeed because the package tarball was restored into the new workspace.

The two persistence mechanisms remain separate:

- Every successful action returns and durably checkpoints its complete workspace
  revision for retry and dependency lineage.
- The reusable cache owns only `.effect-ci/cache/npm` and may be absent without
  changing correctness.

## Compare GitHub and Effect CI

- [`.github/workflows/github.yml`](./.github/workflows/github.yml) uses the conventional
  `setup-node` npm cache and runs the install and verification commands directly.
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml)
  invokes the reusable GitHub runner, which reads the cache policy from
  [`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts).
- [`src/worker.ts`](./src/worker.ts) contains no npm-specific cache plumbing; the
  Cloudflare adapter reads that same policy and maps it to a snapshot.

In both Effect variants, `CI.PackageManager.JavaScript(workspace)` chooses the npm
cache location. The platform adapter only decides how that directory persists.

Run the production-shaped path locally with Docker and Wrangler:

```sh
pnpm dev

pnpm exec wrangler workflows trigger effect-ci-package-manager-cache \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main"}' \
  --id package-cache-online \
  --local

pnpm exec wrangler workflows trigger effect-ci-package-manager-cache \
  '{"repository":"https://github.com/ericclemmons/effect-ci-testbed.git","revision":"main","offline":true}' \
  --id package-cache-offline \
  --local
```
