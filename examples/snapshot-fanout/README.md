# Run checks in parallel from one workspace

Install once, then give parallel checks independent copies of the prepared files.

[Source](./.cloudflare/ci/actions.ts#symbol=isolatedCheck "source")

Both branch actions yield the same `prepare()` dependency. The workflow runs
them with `CI.parallel`. Each writes `branch.txt` without changing the other's
files or the prepared workspace.

## Run it

```sh
cd examples/snapshot-fanout
effect-ci run
```

The local adapter copies the example's `app/` directory per action. It isolates
files, not untrusted commands from the host. Cloudflare uses workspace snapshots
and separate containers.

[Actions](./.cloudflare/ci/actions.ts) ·
[GitHub Actions comparison](./.github/workflows/github.yml)

## cf ci comparison

[cf ci workflow](./.cloudflare/cf-ci/src/index.ts) saves `app/prepared.txt` as a
`step.runner()` output and restores it into the left and right checks, which run
at the same time in separate containers. Each writes the same `branch.txt` and
reads back only its own. It does not use Effect CI.

```sh
(cd examples/snapshot-fanout/.cloudflare/cf-ci && npm ci)
node scripts/cf-ci.mjs snapshot-fanout
```

See [node-npm](../node-npm/README.md#cf-ci-comparison) for how the script
deploys the pipeline and checks the run.
