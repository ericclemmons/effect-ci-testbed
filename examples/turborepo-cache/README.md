# Cache tasks with Turborepo

Keep Turborepo's task cache between CI runs without recreating its hashing rules.

```ts
return yield* workspace.exec("cd app && npx turbo run build")
```

Turborepo decides whether the task inputs match and restores `dist/**` on a hit.
Effect CI's runner persists `.turbo/cache` between runs.

## Try it

From this example directory:

```sh
npm --prefix app ci
npm --prefix app run build
npm --prefix app run build
```

The second build reports a hit. Change a build input and run again to see a miss.

[Runner cache policy](./src/worker.ts) · [Workflow](./.cloudflare/ci/workflow.ts)

You can also use Turborepo's native Remote Cache. Its endpoint, team and signing
credentials belong in runner configuration, not action definitions.
