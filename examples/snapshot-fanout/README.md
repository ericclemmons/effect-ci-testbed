# Run checks in parallel from one workspace

Install once, then give parallel checks independent copies of the prepared files.

[Source](./.cloudflare/ci/actions.ts#symbol=isolatedCheck "source")

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

The adapter also checks that prepare runs once, both branches overlap, and the
source and captured snapshots remain unchanged. Set `EFFECT_CI_SNAPSHOT_RECEIPT`
to an output file to retain its hashes, command intervals and source identity.
The GitHub adapter uploads that receipt as a run-specific artifact. A passing
job without that receipt does not establish every condition in
[the coverage ledger](../remaining-coverage.md).

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)
