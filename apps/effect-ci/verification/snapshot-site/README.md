# Deploy changed output

A small HTML site backed by Cloudflare Workflows, containers and SQLite Durable
Objects. Build output lives in immutable workspace snapshots. The destination
remembers the last successfully published snapshot—not the last build.

```ts
const workspace = yield* build()
if (yield* workspace.changed("dist/**")) yield* deploy()
```

`deploy` publishes the HTML, checks the serving handler's bytes and policy, then
calls `destination.recordSuccessful(workspace, receipt)`. The comparison restores
snapshots in separate, read-only inspection containers. Snapshot IDs and commit
hashes do not determine whether output changed.

## Run on your account

From this directory, after installing the repository's dependencies and signing
in with `cf`:

```sh
../../node_modules/.bin/cf build
../../node_modules/.bin/cf deploy --prebuilt
../../node_modules/.bin/cf workflows instances create effect-ci-snapshot-site-deploy \
  --body '{"params":{"repository":"https://github.com/YOUR/REPO","revision":"FULL_COMMIT_SHA"}}'
```

The public repository needs the example's `outputs/build.mjs`, `app.mjs` and
`shared/message.mjs` under `examples/conditional-deploy`. Change only the shared
module and commit: the app's rebuilt HTML changes, so it publishes. Run the same
source again: it builds but skips `deploy`. A new snapshot containing identical
HTML also skips. Visit the deployed Worker's root to see the current HTML.

Set `EFFECT_CI_SNAPSHOT_SITE_NAME` before building to choose your own Worker name;
its workflow is `<name>-deploy`. Set `EFFECT_CI_SNAPSHOT_SITE_ROOT` to the directory
containing `build.mjs` when using another repository layout (empty for its root).
There are no GitHub App, Slack, signing-key or other account-specific bindings.
Workflow creation requires the account operator; the site's HTTP endpoint only
serves content, never triggers CI.

## Boundaries

This example publishes exactly `dist/index.html`, UTF-8, at most 64 KiB. Its CSP
does not allow scripts. It is not a general Worker bundle deployer or a canary
controller. Existing deployment controllers keep their own approval, rollback
and reconciliation behavior; the snapshot helper only records verified success.

Failed deployment leaves the baseline unchanged. Missing snapshots, target drift,
policy changes and comparison failures run deployment conservatively. Failed
baseline recording does not fail an otherwise successful publication. Same-run
publication is idempotent; replaying an older run cannot rewind the site.

The workflow stops its own containers in a final cleanup step and retains native
history and published snapshots. Output inspection requires `/usr/bin/python3`;
the reused unprivileged standalone image supplies it. Local runtime tests use
real Workflows/RPC/SQLite/HTTP but simulate the container snapshot backend.

## Hosted proof

The [retained native runs](./hosted-proof.json) completed with actual container
snapshots: first publication, identical output from a different commit skips,
shared-package-only output change publishes, then repeating that source skips.
All four produced distinct snapshots. Independent HTTP readback confirmed the
bytes, serving policy and unchanged receipt on skips; no containers remained
active. The [deployed example](https://effect-ci-snapshot-site.ericclemmons.workers.dev/)
is an explicitly owned fixture, not a required destination for other accounts.
