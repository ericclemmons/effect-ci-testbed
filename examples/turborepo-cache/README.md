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
   declares `dist/**` as the build output to restore on a cache hit.
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

GitHub supplies the equivalent policy to `actions/cache`. Cloudflare persistence is
still roadmap work: it must merge only `.turbo/cache` into the current workspace and
must not restore a whole stale workspace snapshot. Turborepo continues to own task
hashing and output correctness after the runner makes those bytes available.
