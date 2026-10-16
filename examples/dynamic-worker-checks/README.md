# Format code without a container

> How do I format-check source without paying to execute the formatter inside a container?

```mermaid
flowchart LR
  step_checkout["checkout"]
  step_format_source["format source"]
  step_checkout --> step_format_source
```

---

The action reads source through `CI.Workspace` and calls a portable source tool:

```ts
const source = yield* workspace.readFile("app/src/index.ts")
const formatted = yield* Tools.format({ files: { "app/src/index.ts": source }, options: { semi: false } })
```

The default service runs Prettier locally or on a GitHub runner. The hosted runner
provides an Effect service that executes the same operation through WorkerLoader in
a separate Dynamic Worker. Its outbound network is disabled, it receives no secrets
or filesystem bindings, and its CPU budget is bounded. This is not execution in the
parent Workflow Worker.

This proves a source-in/result-out execution tier, not arbitrary project execution.
Oxlint, Oxfmt, and Vitest can use the same path when they expose Worker-compatible
JavaScript or Wasm APIs. Arbitrary project modules, native executables, and Vite+
toolchain compatibility remain separate work; this example runs a pinned formatter
against untrusted source data.

### Pinned Oxfmt / Oxlint compatibility finding

The [independent investigation tests](./src/oxc-compatibility.test.mjs) use this
recipe's own dev dependency on Vite+ 1.0.0 and its genuine Oxfmt 0.70.0 / Oxlint
1.85.0 artifacts. They bundle tooling without executing it in Node, then load it
in real **local** WorkerLoader children: empty bindings, no Node compatibility,
`globalOutbound:null`, zero subrequests and 1,000 ms CPU. No process/FS shim,
native addon, replacement formatter or child-process fallback is supplied.

- Oxfmt's unchanged public `format` API fails child module initialization. A plain
  bundle also encounters absent optional Prettier plugins; leaving those unused
  imports unresolved does not remove the Node module/`createRequire` boundary.
- Oxlint's public JavaScript entrypoint loads, but exports only `defineConfig`,
  not a lint engine. Its CLI imports its native-binding loader and uses process
  arguments. Loading a configuration helper is not successful lint execution.
- Official registry GETs on October 16 returned 404 for
  `@oxfmt/binding-wasm32-wasi` and `@oxlint/binding-wasm32-wasi`, both at these
  versions and as package metadata. The generic
  [upstream binding guidance](https://oxc.rs/docs/guide/troubleshooting.html)
  is not evidence that these exact artifacts are published. The
  [Oxfmt API guide](https://oxc.rs/docs/guide/usage/formatter/quickstart.html#node-js-api)
  explicitly describes a Node API.

```sh
cd examples/dynamic-worker-checks
pnpm install
pnpm test:oxc-compatibility
```

These are reproducible **unsupported pinned-artifact findings**, not hosted
Oxfmt/Oxlint support, a universal impossibility proof, CPU measurements or a new
toolchain rollout. No hosted resource was created/redeployed for this investigation.
Future Worker-compatible artifacts must be investigated afresh; do not substitute
the existing Prettier proof or silently execute native tools.

## Owned containerless deployment

This directory owns its [private Worker/config](./cloudflare.config.ts),
[wrapper](./src/worker.ts), [formatted source](./app/src/index.ts),
[negative fixture](./fixtures/unformatted.txt), and Vite setup. It imports reusable
packages, not another app or example implementation. There is **no Dockerfile,
Container, Durable Object workspace, shell execution or workspace snapshot**.

The native wrapper accepts exactly `{ "mode": "formatted" }` or
`{ "mode": "unformatted" }`. Both source fixtures are bundled as raw text, not
imported/executed as host code. No actor code, repository, token, tool options or
outbound destination is accepted. The existing portable actions read `CI.Workspace`
and call `SourceTools`; this host supplies only the fixed text and the real
WorkerLoader service. A deliberately unformatted fixture must leave the native
Workflow errored, even though the formatter itself successfully returns corrected text.

The trusted formatter child has explicit empty environment bindings,
`globalOutbound:null`, 1,000 ms CPU and zero subrequests. Parent-side bundling may
fetch the pinned Prettier 3.6.2 package; the formatted source is data, not arbitrary
project execution. The project-code capability tests belong to the separate
[project-check recipe](../dynamic-project-checks), not a claim about executing source here.

From this monorepo (workspace packages are still private/unpublished):

```sh
CI=true pnpm_config_pm_on_fail=ignore pnpm install --frozen-lockfile
node --test examples/dynamic-worker-checks/src/ownership.test.ts apps/example-runner/src/source-tools.test.ts
examples/dynamic-worker-checks/node_modules/.bin/tsc -p examples/dynamic-worker-checks/tsconfig.json
node packages/cli/src/bin.ts run --workflow examples/dynamic-worker-checks/.cloudflare/ci/workflow.ts --format=json
```

The last command uses local Prettier, not WorkerLoader. Before deployment confirm
Worker `effect-ci-source-formatter` and Workflow `effect-ci-source-formatter-checks`
are absent. Stop if an existing resource is found; do not overwrite a shared host.
With existing authorized Workers/Workflows/WorkerLoader access:

```sh
cf workers deployments list --worker effect-ci-source-formatter --per-page 1
cf workflows instances list --workflow-name effect-ci-source-formatter-checks
cd examples/dynamic-worker-checks
cf build
cf deploy --prebuilt
cf workflows instances create effect-ci-source-formatter-checks --body '{"instance_id":"my-owned-formatter-positive","params":{"mode":"formatted"}}'
cf workflows instances get my-owned-formatter-positive --workflow-name effect-ci-source-formatter-checks
cf workflows instances create effect-ci-source-formatter-checks --body '{"instance_id":"my-owned-formatter-negative","params":{"mode":"unformatted"}}'
cf workflows instances get my-owned-formatter-negative --workflow-name effect-ci-source-formatter-checks
```

The Worker has no secrets/public URL/HTTP execution route, and only `LOADER` is
bound. Source reads and formatter RPC checkpoints have zero retries. An ambiguous
create/deploy ACK requires reading the existing resource/history, not blind retry.
Costs are parent Workflow/Worker, bundler requests and child WorkerLoader execution;
there is no Container billing for this recipe. No new account permission, paid
provider, GitHub App, Slack or AI integration is needed.

Optional cleanup requires explicit owner authorization and retained evidence.
In Cloudflare's dashboard remove only this owned Workflow and Worker. No bucket,
Container or SQLite namespace is created. Never reset negative histories or remove
the shared example host to hide failures. The older shared-host runs below are not relabeled.

### Fresh standalone native proof

Exact merged source `e154edb5040bc0ea199e2acbda09f8cd21709097` deployed Worker
`a104511a-1174-4389-89fd-0f4966d31787`: one Workflow export, only `LOADER`,
no Container/storage exports, environment secrets or public URLs.
`coverage-owned-isolate-formatted-20261015-1` completed on Workflow version
`5d2e54e3-c420-4763-9e84-9bce839cca15`, two checkpoints once with zero retries.
The real WorkerLoader RPC returned `runtime:"dynamic-worker"` and unchanged formatted
text; both CI nodes completed with no commands, secrets or snapshots.

`coverage-owned-isolate-unformatted-20261015-1` remains **ERRORED** after the
same real formatter successfully returned different, corrected text. This is an
expected CI check failure, not a failed tool RPC relabeled as success.
`coverage-owned-isolate-formatter-extra-20261015-1` rejected extra actor source
before any step. No history was reset or replayed.

The positive queued for 2,106 ms and executed for 4,604 ms (6,710 ms total), one
cold orchestration sample including bundler/RPC work, not a benchmark or SLA.
Read these retained records without formatting again:

```sh
LIVE_OWNED_FORMATTER=1 CF_BIN=cf node --test examples/dynamic-worker-checks/src/live.test.ts
```

## Historical shared-host proof

The [hosted example runner](../../apps/example-runner) imported this workflow unchanged.
Instance `coverage-dynamic-formatter-20261009-1` completed both actions at immutable
source `b7c510ed661c1c221072849ba1b1dd93308e702a`. The native Workflow
`effect-ci-example-dynamic-formatter` recorded only two steps: GitHub source retrieval
and formatter RPC, whose result reports `runtime: "dynamic-worker"`. This path has no
Container checkout, commands, or snapshots. The earlier parent-Worker formatter proof
is preserved as historical evidence.
Those historical runs used that app's platform configuration, not this new owned host.

`coverage-dynamic-formatter-negative-20261009-1` used deliberately unformatted source
at `b083b10cb636a980498934d8bda6dd1f3dc3b449`: the Dynamic Worker returned formatted
text and the CI check rejected it as expected. Both cases also passed through the
local `cf dev` Workflow API (`local-dynamic-formatter-20261009-1` and
`local-dynamic-formatter-negative-20261009-1`). These are formatter checks, not deployments.

The final RPC-lifetime fix was rechecked on deployment
`f3913a23-0eaf-4d64-b10f-30ba77c5126f`: instances
`coverage-dynamic-formatter-result-disposed-20261009-1` and
`coverage-dynamic-formatter-result-negative-20261009-1` retained those same results.
The earlier `coverage-dynamic-formatter-disposed-20261009-1` failure is preserved:
it exposed an incorrect attempt to dispose the entrypoint rather than its RPC result.

Compare the conventional [GitHub Actions workflow](./.github/workflows/github.yml) with
the portable [actions](./.cloudflare/ci/actions.ts) and
[workflow](./.cloudflare/ci/workflow.ts).

## Verification proof

**Video:** Pending — no same-run recording has been published for this recipe.

**Measured results:** Pending — no structured per-environment timing summary has
been published here. Existing recorded runs and coverage claims remain as documented;
missing media or measurements do not imply those runs failed or were never verified.

Use the [proof-page contract](../PROOF-PAGES.md) for exact revision/environment,
assertions, video/transcript, outcome and cold/warm timings. See the
[coverage matrix](../../README.md#recipes-by-feature) for current backend support.
