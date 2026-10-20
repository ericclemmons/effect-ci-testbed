# Run checks in parallel from one workspace

Install once, then give parallel checks independent copies of the prepared files.

```ts
const workspace = yield* prepare()
```

Both branch actions yield the same `prepare()` dependency. The workflow runs
them with `CI.parallel`. Each writes `branch.txt` without changing the other's
files or the prepared workspace.

## Run it

```sh
pnpm exec cf-ci run --workflow examples/snapshot-fanout/.cloudflare/ci/workflow.ts
```

The local adapter copies the example's `app/` directory per action. It isolates
files, not untrusted commands from the host. Cloudflare uses workspace snapshots
and separate containers.

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)
