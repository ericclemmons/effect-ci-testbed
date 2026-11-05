# Cache tasks with Turborepo

Keep Turborepo's task cache between CI runs without recreating its hashing rules.

[Source](./.cloudflare/ci/actions.ts#symbol=build "source")

Turborepo decides whether the task inputs match and restores `dist/**` on a hit.
Effect CI's runner discovers and persists `.turbo/cache` between runs, including
the nested app's cache. No runner cache key or paths are needed.

## Try it

From this example directory:

```sh
npm --prefix app ci
npm --prefix app run build
npm --prefix app run build
```

The second build reports a hit. Change a build input and run again to see a miss.

[Runner](./src/worker.ts) · [Workflow](./.cloudflare/ci/workflow.ts)

You can also use Turborepo's native Remote Cache. Its endpoint, team and signing
credentials belong in runner configuration, not action definitions.
