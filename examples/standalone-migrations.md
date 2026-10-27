# Standalone migration inventory

Inventory baseline: `20f29103911800606929de4f9afa095667606e48` (`main`), inspected
October 26, 2026. [Tracker #162](https://github.com/ericclemmons/effect-ci-testbed/issues/162)
stays open until every retained recipe has owned infrastructure and independent
deployment/run evidence. This inventory does not grant resource authority.

## Ownership and sequence

The repository's [working rules](../AGENTS.md) require recoverable proofs and
collocated documentation. The [docs guide](../apps/docs/README.md), updated on
October 24 in `a33da24`, defines source inclusion. No separate current standalone
migration SOP was found. Concrete prior art is the landed
[Artifacts host](./artifacts-source/cloudflare.config.ts), the source migrations
closed October 16, and the matrix/splitting proofs landed October 24 in `65d53d3`.
Use their owned config/binding/wrapper pattern, not their authority to provision.

The tracker asks for follow-up tickets, but the current delegated scope forbids
new issues and asks for small groups in this chat. This file tracks the first
group without opening tickets or changing other issue ownership. The tracker's
stale blocker heading was changed to completed prerequisites; its remaining
acceptance criteria and open state were preserved. No external comments,
resource changes or history cleanup are needed for this inventory.

- #128–#131 are **closed**, not blockers: R2, DO, public GitLab and both Dynamic
  Worker recipes already have standalone proof.
- #149 owns Docker execution; #151 ordered deployment; #152 D1; #156 previews;
  #161 comparison gaps and snapshot/secret comparison work. Health work remains
  with #138–#141. Do not change these recipes concurrently.
- #148 Blacksmith, #150 project-image publication, #157 Discord and #158 GitHub
  approval were closed as not planned. Do not migrate those retired scopes.
- #163 docs is closed as accepted. This is a migration ledger, not a docs rewrite.
- #165/#166 recording scope is undecided; #176 is future. No video work is added.
- #145/#146 are closed execution/recovery proofs, not implicit ownership of a
  new standalone host. Keep their existing receipts and runtime contracts.

## Independently deployed proof already retained

These are recorded historical proofs, not fresh executions at the baseline.
Closed-issue receipts and committed assertions identify the exact environments;
they do not prove arbitrary current source revisions.

| Recipe | Exact retained standalone evidence | Boundary |
| --- | --- | --- |
| R2 | [#128 closure](https://github.com/ericclemmons/effect-ci-testbed/issues/128); source `fb740d7f490dd1b523c581d14708aeac2442dfb9`, Worker `41539d8a-2f86-4934-9052-b892ac0e7246`, `coverage-owned-r2-valid-20261015-1` | Digest-pinned private materialization and downstream restore; retained invalid inputs fail. Container-backed. |
| Durable Object source | [#129 closure](https://github.com/ericclemmons/effect-ci-testbed/issues/129); source `3401b3c8820f96810ee94e9d7e15b7991a695248`, Worker `ddced780-6e9d-4403-bfb8-53b5c9227a7e`, `coverage-owned-do-first-20261015-1` and `coverage-owned-do-replay-20261015-1` | Same immutable bytes restored; boundary and foreign-source histories stay separate. Container-backed. |
| Public GitLab source | [#130 closure](https://github.com/ericclemmons/effect-ci-testbed/issues/130); source `b3ede7b150250f8d71cc576efe2c3bfc5f278011`, Worker `18a11254-debf-41e6-a6a4-f0e3dcbc7d39`, `coverage-owned-gitlab-pinned-20261015-1` | Actual public pinned clone/restore; mutable ref rejected. Not private auth or GitLab CI. |
| Dynamic formatter/project | [#131 closure](https://github.com/ericclemmons/effect-ci-testbed/issues/131); source `e154edb5040bc0ea199e2acbda09f8cd21709097`, Workers `a104511a-1174-4389-89fd-0f4966d31787` / `abb69881-68f0-42d7-b34a-de5ced629a7f`, `coverage-owned-isolate-formatted-20261015-1` / `coverage-owned-isolate-project-20261015-1` | Real WorkerLoader RPC; not general Oxfmt/Oxlint/Vitest support. |
| Artifacts source | [Retained assertions](./artifacts-source/src/live.test.ts); `coverage-artifacts-standalone-20261012-1`, source `e8faf6e46a9dde90067658d87d128c71796ed8c0`, Workflow version `88285523-ea4a-477c-ac9c-8b8f0334fcd9` | Includes separately retained rejection/restore proofs, not full-repository export. |
| Static assets | [Retained assertions](./static-assets-source/src/live.test.ts); `coverage-owned-static-assets-fixed-20261015-1`, target version `2d544397-ed8a-4854-8e79-c27477f424a2` | Keep original failed publication and GET-only reconciliation separate. |
| Containerless site | [Native receipt](./containerless-site/verification/published/native-cf6dd38.json) and [browser receipt](./containerless-site/verification/published/browser-cf6dd38.json) | Exact pinned public-site proof only; no new recording scope. |
| Matrix, test splitting, timing-aware splitting | [Manifest and raw receipts](./parallel-recipes-proof/cloudflare/manifest.json), source `98a3452d3ff55dc0980b3331df13b55dacd2655a`; `matrix-20261024-2`, `splitting-20261024-1`, `timing-cold-20261024-1`, `timing-warm-20261024-1` | Real independent wrappers; package-library Dockerfile remains explicit. No speedup claim. |

## Retained shared-host recipes

The baseline [shared configuration](../test/apps/example-runner/cloudflare.config.ts)
and [native wrappers](../test/apps/example-runner/src/worker.ts) still export these
recipes. Their `coverage-*` histories remain on the shared host; none is renamed
or upgraded into standalone proof by this change. Probes are host diagnostics,
not additional recipes to migrate.

| Recipe/group | Baseline ownership gap | Next owner/action |
| --- | --- | --- |
| npm, pnpm, zero-config, exported actions | Native wrappers/config/image are shared; zero-config imports the host manifest reader | First group below adds recipe-owned hosts; independent deployment/run still pending. |
| Cloudflare runner, Python toolchain, custom runner image | Own wrappers/config already exist; runner/toolchain reference the reusable package image, while Python/custom-image READMEs still direct readers to the shared host | #162 follow-up group; verify image selection and independent outcomes before changing claims. |
| npm download, Vite+, Turborepo and custom cache policy | Own wrappers/config already exist with an explicit package image; fresh cold/warm independent receipts are missing here | #162 cache group; retain cache identity/paths and use separate instances. |
| Snapshot fanout | Own wrapper/config, but hosted proof in the shared ledger | Coordinate #161; do not change its example in this group. |
| Node version, mise, system package | Shared wrappers/image; mise uses the host's `Dockerfile.mise` | #162 toolchain group; copy necessary recipe image/setup, not another example's image. |
| Optional checks, retry, execution policy, rollback compensation | Shared wrappers/config; rollback is echo-only, not an authorized deployment | #162 control-flow group; preserve expected failures and retry counts without adding release features. |
| Conditional deploy | Shared native wrapper/config; simulated deployment | #162 ownership only; real preview behavior belongs to #156. |
| Portable artifacts | Shared wrapper/config and Container | #162 artifact group; verify publication, downstream restore and immutable bytes. |
| Secure secrets | Shared wrapper and secret resolver | #162 scoped secret group; no secret values or new grants. Preserve redaction/missing-secret failures. |
| Secret outbound | Shared interceptor, credential vault and dedicated Container wrapper | Coordinate #161 before moving; retain fixed-operation credential boundary. |
| Deploy hook | Own deploy fixture/config, but native CI wrapper is shared | #162 host wrapper only; keep `cf deploy --dry-run` semantics, not a webhook service or real release. |
| Release flywheel/check reuse | Proof scripts import shared-host identity/trust; trusted wrapper remains on the host | Coordinate #144; moving trust/signers is not a mechanical wrapper copy. |
| Health release / health approval | Controllers, telemetry and broker dependencies are in test apps | Existing health owners #138–#141; no edits or broker/target authority under this group. |

Local-only source providers, local containers, runner selection and small-change
helpers do not become Cloudflare deployment projects just to satisfy an inventory.
GitHub-host integration remains a service concern. Dependency-aware reruns and
immutable attempts retain their already-owned CLI/provider scope and proofs.
Ordered deployment, D1 and real preview infrastructure remain separate work.

## First review group: basic checks

The changes in this branch add `hosted/` packages to npm, pnpm, zero-config and
exported actions. Every package owns config, native wrapper, SQLite Container
binding and Dockerfile; each imports only its own recipe and reusable libraries.
Separate host manifests keep frozen fixture installs and zero-config script
discovery unchanged. Zero-config copies the existing validated manifest reader.
Existing shared-host exports stay in place to preserve pinned histories.

Baseline call path: landed `20f2910`. Added paths below are implemented by this
unlanded review group, not new library APIs or deployed infrastructure:

```diff
- test/apps/example-runner/cloudflare.config.ts owns the only basic-check host
- test/apps/example-runner/src/worker.ts -> workflowEntrypoint(workflow, options)
+ examples/<recipe>/hosted/cloudflare.config.ts owns a separate host and image
+ examples/<recipe>/hosted/src/worker.ts -> workflowEntrypoint(workflow, options)
  Cloudflare.workflowEntrypoint(workflow | async (parameters, step) => workflow, options)
    -> native Workflow.run(event, step)
-     -> zero-config callback -> shared-host readSourceManifest(source, root, request?)
+     -> zero-config callback -> recipe-owned readSourceManifest(source, root, request?)
      -> CI.fromPackageJson(manifest).workflow (zero-config only)
      -> CI.run(definition, { source, executor, actionExecutor, ... })
        -> owned WorkspaceContainer -> checkout/commands/checkpoints
        -> native Workflow history and final plan, or existing action/fetch error
  HTTP fetch() -> 404; no HTTP dispatch, callback endpoint or automatic deletion
+ old shared-host wrappers/exports remain for historical compatibility
```

The added hosts have **no independent deployment or run receipts**. Their setup
guides name new resources rather than taking over the old shared Workflows:
[npm](./node-npm/hosted/README.md), [pnpm](./node-pnpm/hosted/README.md),
[zero-config](./zero-config/hosted/README.md),
[exported actions](./exported-actions/hosted/README.md).

Before any hosted proof, obtain the exact account and budget approval for four
new Workers (`effect-ci-node-npm`, `effect-ci-node-pnpm`,
`effect-ci-zero-config`, `effect-ci-exported-actions`), their corresponding
`-checks` Workflows, `-workspace` Container applications, four images and SQLite
Container namespaces. Start at most one proof at a time, one instance per recipe;
request a separate bound for retries or follow-up failure probes. Snapshots,
Container compute, builds and log retention may incur cost. Do not infer
authorization from an existing login. No new secret, public endpoint, R2 bucket,
Artifacts repository, release target or broker grant is required by these configs.

Local validation of this unlanded group on October 26 used Node 24.22.1:
all four host TypeScript projects passed; all four portable workflows completed;
58 existing documentation, CLI, consumer-workflow and source-reader assertions
passed without test changes. All four `cf build` commands produced Worker bundles
and local Docker images (shared local image manifest
`sha256:465ebbf96c5b2b74fd7306b651e06f29dbf80c10103a7dbec2b312ace1285d1f`).
The Starlight build produced 92 pages. Replaying the committed parallel-recipe
assertions passed without dispatching any Workflow. These local checks do not
establish fresh hosted behavior, account access or a cloud deployment.

After authorized execution, retain exact source SHA, deployment/Workflow versions,
image digest, instance IDs, timestamps and outcomes under the recipe. Record
failures as failures. Do not close #162 until the remaining retained groups also
meet its independent ownership and execution criteria.
