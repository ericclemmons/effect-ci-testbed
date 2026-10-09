# Reuse the Turborepo cache

> How can separate CI runs reuse Turborepo task results while Turborepo remains
> responsible for deciding whether a build is valid?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_install["install"]
  step_build["build"]
  step_checkout --> step_install
  step_install --> step_build
```

---

The responsibilities are intentionally split:

1. Turborepo hashes the task, its inputs, and its dependencies. Its `turbo.json`
   declares `dist/**` as the build output to restore on a cache hit and requires
   signatures for remote artifacts.
2. Effect CI persists the opaque `.turbo/cache` directory in a rolling Container
   snapshot. It does not reproduce Turborepo's hashing rules.

## Compare GitHub and Effect CI

- [`.github/workflows/github.yml`](./.github/workflows/github.yml) restores
  `.turbo/cache` with `actions/cache` and invokes Turborepo directly.
- [`.github/workflows/effect-on-github.yml`](./.github/workflows/effect-on-github.yml)
  supplies the same path to the reusable GitHub runner before executing
  [`.cloudflare/ci/workflow.ts`](./.cloudflare/ci/workflow.ts).
- [`src/worker.ts`](./src/worker.ts) supplies Cloudflare's snapshot-backed cache to the
  same workflow.

This is the intended layer boundary: orchestration names no cache vendor; the runner
owns persistence; Turborepo owns cache validity.

## Native remote cache

No Effect CI evidence is required when a developer and CI use the same native Turbo
Remote Cache. The developer's successful `turbo run build` uploads the hashed outputs;
CI invokes the same command, verifies the HMAC-SHA256 artifact signature, restores the
output, and reports a cache hit without executing the build again.

Turborepo reads its standard configuration directly:

```sh
TURBO_API=https://cache.example.test
TURBO_TEAM=example
TURBO_TOKEN=...
TURBO_REMOTE_CACHE_SIGNATURE_KEY=...
```

Those credentials belong to the runner. On GitHub they can be ordinary job secrets.
On Cloudflare they should terminate at the host-side credential proxy rather than be
copied into the workspace Container. Effect CI does not reinterpret Turbo's cache key,
artifact, or signature protocol.

The userland action is an ordinary command:

```ts
export const build = CI.action("build", () => function* () {
  const workspace = yield* install()

  return yield* workspace.exec(
    "cd app && npx turbo run build",
  )
})
```

## Verify it locally

Run the task twice from the fixture root:

```sh
npm --prefix app ci
npm --prefix app run build
npm --prefix app run build
```

The second run reports a cache hit. Delete `app/packages/message/dist` before the
second run to also see Turborepo restore the declared output.

## Runner-owned persistence

The portable workflow remains cache-agnostic. A runner opts into persistence and
identifies Turborepo's local cache directory:

```ts
Cloudflare.workflowEntrypoint(workflow, {
  cache: {
    key: "turbo-task",
    keyFiles: ["examples/turborepo-cache/app/package-lock.json"],
    paths: ["examples/turborepo-cache/app/.turbo/cache"],
  },
})
```

GitHub supplies the equivalent policy to `actions/cache`. On Cloudflare, a new checkout
cleans stale untracked outputs and dependencies while preserving the declared cache
directory. Turborepo continues to own task hashing and output correctness.

## Hosted coverage

The [hosted example runner](../../apps/example-runner) populated the cache in
`coverage-turborepo-warm-20261008-2`, then a distinct
`coverage-turborepo-hit-20261008-1` instance reported one cached task and restored the
build result in an 85 ms task run. The hash was `f37d6ec47086f918` in both instances.
This proves runner-backed filesystem cache reuse; Turbo's separate remote-cache API
was disabled and is not claimed as part of this hosted proof.
