# Reuse a package-manager download cache

> How does an install reuse package-manager downloads without replacing its incoming workspace?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_install["install"]
  step_verify["verify"]
  step_checkout --> step_install
  step_install --> step_verify
```

---

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

The GitHub runner persists that tool-owned directory with `actions/cache`. The
Cloudflare runner uses snapshots as transport, checks out the requested source again,
and preserves only the configured tool cache paths across command execution. Cached
workspace state is not returned in place of running installation.

The repository test runs the Effect workflow once to populate that directory, then
uses it to install into a fresh workspace with npm's network access disabled. The
Cloudflare adapter is also bundled in CI. The [hosted example runner](../../apps/example-runner)
completed `coverage-npm-cache-warm-20261008-1`, then a distinct
`coverage-npm-cache-offline-20261008-2` instance ran `npm ci --offline` and verified
the dependency. Both instances retain native checkpoints and command output in the
Cloudflare dashboard. This hosted proof does not imply local emulator parity.

The two persistence mechanisms remain separate:

- Every successful action returns and durably checkpoints its complete workspace
  revision for retry and dependency lineage.
- The reusable cache owns only `.effect-ci/cache/npm` and may be absent without
  changing correctness.

## Compare GitHub and Effect CI

- [`.github/workflows/github.yml`](./.github/workflows/github.yml) uses the conventional
  `setup-node` npm cache and runs the install and verification commands directly.
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml)
  invokes the reusable GitHub runner with its cache policy.
- [`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts) remains cache-agnostic.
- [`src/worker.ts`](./src/worker.ts) is where a Cloudflare runner receives the
  corresponding policy; the hosted runner uses the same policy with a repository-scoped key.

In both Effect variants, `CI.PackageManager.JavaScript(workspace)` chooses the npm
cache location. The platform adapter only decides how that directory persists.

Run the workflow locally:

```sh
pnpm cf-ci --workflow examples/package-manager-cache/.cloudflare/ci/workflow.ts
```
