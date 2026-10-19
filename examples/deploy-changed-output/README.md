# Build freely. Deploy only changed output.

> A shared module changed, but no app source did. Should the app deploy?

Yes—if its rebuilt deployable output changed. A source watchlist restricted to
`app/**` would miss that dependency. Compare the build result instead:

```ts
const workspace = yield* build()
if (yield* workspace.changed("dist/**")) {
  yield* deploy()
}
```

This standalone recipe owns its app, shared module, workflow and local deployment
state. It imports reusable library packages, not another example.

## Try it

After the repository dependencies are installed, from the repository root:

```sh
pnpm cf-ci run --workflow examples/deploy-changed-output/.cloudflare/ci/workflow.ts --format=text
# checkout → build → deploy

pnpm cf-ci run --workflow examples/deploy-changed-output/.cloudflare/ci/workflow.ts --format=text
# checkout → build; no deploy action
```

Edit [`packages/greeting/message.mjs`](./packages/greeting/message.mjs), changing
only the greeting. Run again: `deploy` returns because the app imports that module
and its HTML changes. [`app/src/page.mjs`](./app/src/page.mjs) need not change.
Repeat without another edit: deployment skips again.

Changing a README, or rebuilding identical output, does not redeploy. Likewise,
a dependency/lockfile change that produces identical deployable bytes does not
require publication just because its source changed.

The build deliberately runs every time in this small dependency-free fixture.
It demonstrates a real ESM dependency, not automatic affected-project discovery
or a simulated Vite cache hit. In a Vite/Vite+ app, keep your existing build/cache
command inside `build`; this comparison happens after that tool has produced or
restored `dist`. See the separate [Vite+ cache recipe](../vite-plus-cache).

## What counts as a deployment?

The [directory adapter](../../packages/ci/src/directory-deployment.md) actually
copies and reads back the complete configured `dist/**` scope, then atomically
records success under `.effect-ci/deployments/site` (ignored by Git).
It compares file paths, contents, executable bits and configured destination
policy—not commit or snapshot IDs. Failed publication keeps the old baseline;
missing or unreadable state conservatively runs deployment. Each destination
needs its own baseline.

This command publishes a **local directory**, not a Cloudflare deployment. For
the actual snapshot-backed Cloudflare HTML publisher, use the
[deployable Cloudflare site](../../apps/effect-ci/verification/snapshot-site).
It has retained real hosted proof; that proof is not relabeled as a hosted run
of this new standalone recipe. No account credentials are needed for this local example.

## Source selection is a separate decision

For the contrived lint example:

```ts
const source = yield* CI.Source
if (yield* source.changed(["**/*.ts", "**/*.tsx", "eslint.config.*", "package.json", "pnpm-lock.yaml"])) {
  yield* lint()
}
```

This skips lint only for a complete nonmatching diff. The package/config/lockfile
patterns matter because tooling can change without any TypeScript edit. Include
nested package manifests explicitly when relevant, for example `packages/**/package.json`.
The event adapter normally supplies the comparison; no mandatory `since` argument.
Missing history or comparison metadata runs lint safely.
See [source conditions](../conditional-deploy) for the runnable source-query recipe.

## Verification proof

**Measured results:** [CLI regression](./workflow.test.ts) builds and publishes across separate
processes, skips identical output, republishes after a shared-only edit, and skips
after an unrelated README edit. It also checks that failed builds do not advance
the publication baseline. This is local evidence, not a hosted deployment claim.

[Proof requirements](../PROOF-PAGES.md).
